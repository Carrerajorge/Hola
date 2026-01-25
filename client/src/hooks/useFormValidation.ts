import { useState, useCallback, useMemo } from 'react';
import {
  validateEmail,
  validatePassword,
  validatePasswordMatch,
  validateUsername,
  validatePhone,
  validateUrl,
  validateRequired,
  validateLength,
  getPasswordStrength,
  type ValidationResult,
  type PasswordStrength,
} from '@/lib/validation';

export type FieldValidator<T = string> = (value: T) => ValidationResult;

export interface FormField<T = string> {
  value: T;
  error: string | null;
  warnings: string[] | null;
  touched: boolean;
  isValid: boolean;
}

export interface UseFormValidationReturn<T extends Record<string, unknown>> {
  fields: { [K in keyof T]: FormField<T[K]> };
  values: T;
  errors: { [K in keyof T]: string | null };
  touched: { [K in keyof T]: boolean };
  isValid: boolean;
  isDirty: boolean;
  setFieldValue: <K extends keyof T>(field: K, value: T[K]) => void;
  setFieldTouched: <K extends keyof T>(field: K, touched?: boolean) => void;
  validateField: <K extends keyof T>(field: K) => ValidationResult;
  validateAll: () => boolean;
  reset: () => void;
  getFieldProps: <K extends keyof T>(field: K) => {
    value: T[K];
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onBlur: () => void;
    'aria-invalid': boolean;
    'aria-describedby': string;
  };
}

/**
 * Hook for form validation with support for custom validators
 */
export function useFormValidation<T extends Record<string, unknown>>(
  initialValues: T,
  validators: { [K in keyof T]?: FieldValidator<T[K]> }
): UseFormValidationReturn<T> {
  const [values, setValues] = useState<T>(initialValues);
  const [touched, setTouched] = useState<{ [K in keyof T]: boolean }>(
    () => Object.keys(initialValues).reduce(
      (acc, key) => ({ ...acc, [key]: false }),
      {} as { [K in keyof T]: boolean }
    )
  );
  const [errors, setErrors] = useState<{ [K in keyof T]: string | null }>(
    () => Object.keys(initialValues).reduce(
      (acc, key) => ({ ...acc, [key]: null }),
      {} as { [K in keyof T]: string | null }
    )
  );
  const [warnings, setWarnings] = useState<{ [K in keyof T]: string[] | null }>(
    () => Object.keys(initialValues).reduce(
      (acc, key) => ({ ...acc, [key]: null }),
      {} as { [K in keyof T]: string[] | null }
    )
  );

  const validateField = useCallback(<K extends keyof T>(field: K): ValidationResult => {
    const validator = validators[field];
    if (!validator) {
      return { isValid: true };
    }

    const result = validator(values[field] as T[K]);
    setErrors(prev => ({ ...prev, [field]: result.error || null }));
    setWarnings(prev => ({ ...prev, [field]: result.warnings || null }));
    return result;
  }, [values, validators]);

  const setFieldValue = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValues(prev => ({ ...prev, [field]: value }));

    // Validate on change if field was touched
    if (touched[field]) {
      const validator = validators[field];
      if (validator) {
        const result = validator(value);
        setErrors(prev => ({ ...prev, [field]: result.error || null }));
        setWarnings(prev => ({ ...prev, [field]: result.warnings || null }));
      }
    }
  }, [touched, validators]);

  const setFieldTouched = useCallback(<K extends keyof T>(field: K, isTouched: boolean = true) => {
    setTouched(prev => ({ ...prev, [field]: isTouched }));

    if (isTouched) {
      validateField(field);
    }
  }, [validateField]);

  const validateAll = useCallback((): boolean => {
    let isAllValid = true;
    const newErrors: Partial<{ [K in keyof T]: string | null }> = {};
    const newWarnings: Partial<{ [K in keyof T]: string[] | null }> = {};

    for (const field of Object.keys(validators) as (keyof T)[]) {
      const validator = validators[field];
      if (validator) {
        const result = validator(values[field] as T[typeof field]);
        newErrors[field] = result.error || null;
        newWarnings[field] = result.warnings || null;
        if (!result.isValid) {
          isAllValid = false;
        }
      }
    }

    setErrors(prev => ({ ...prev, ...newErrors }));
    setWarnings(prev => ({ ...prev, ...newWarnings }));
    setTouched(Object.keys(initialValues).reduce(
      (acc, key) => ({ ...acc, [key]: true }),
      {} as { [K in keyof T]: boolean }
    ));

    return isAllValid;
  }, [validators, values, initialValues]);

  const reset = useCallback(() => {
    setValues(initialValues);
    setTouched(Object.keys(initialValues).reduce(
      (acc, key) => ({ ...acc, [key]: false }),
      {} as { [K in keyof T]: boolean }
    ));
    setErrors(Object.keys(initialValues).reduce(
      (acc, key) => ({ ...acc, [key]: null }),
      {} as { [K in keyof T]: string | null }
    ));
    setWarnings(Object.keys(initialValues).reduce(
      (acc, key) => ({ ...acc, [key]: null }),
      {} as { [K in keyof T]: string[] | null }
    ));
  }, [initialValues]);

  const getFieldProps = useCallback(<K extends keyof T>(field: K) => ({
    value: values[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setFieldValue(field, e.target.value as T[K]);
    },
    onBlur: () => setFieldTouched(field),
    'aria-invalid': !!errors[field],
    'aria-describedby': `${String(field)}-error`,
  }), [values, errors, setFieldValue, setFieldTouched]);

  const fields = useMemo(() => {
    return Object.keys(initialValues).reduce((acc, key) => {
      const k = key as keyof T;
      return {
        ...acc,
        [k]: {
          value: values[k],
          error: errors[k],
          warnings: warnings[k],
          touched: touched[k],
          isValid: !errors[k],
        },
      };
    }, {} as { [K in keyof T]: FormField<T[K]> });
  }, [values, errors, warnings, touched, initialValues]);

  const isValid = useMemo(() => {
    return Object.values(errors).every(error => error === null);
  }, [errors]);

  const isDirty = useMemo(() => {
    return Object.keys(initialValues).some(
      key => values[key as keyof T] !== initialValues[key as keyof T]
    );
  }, [values, initialValues]);

  return {
    fields,
    values,
    errors,
    touched,
    isValid,
    isDirty,
    setFieldValue,
    setFieldTouched,
    validateField,
    validateAll,
    reset,
    getFieldProps,
  };
}

/**
 * Pre-built hook for login form validation
 */
export function useLoginFormValidation() {
  return useFormValidation(
    { email: '', password: '' },
    {
      email: (value: string) => validateEmail(value),
      password: (value: string) => validateRequired(value, 'La contraseña'),
    }
  );
}

/**
 * Pre-built hook for registration form validation
 */
export function useRegistrationFormValidation() {
  const form = useFormValidation(
    { email: '', password: '', confirmPassword: '', username: '' },
    {
      email: (value: string) => validateEmail(value),
      password: (value: string) => validatePassword(value),
      username: (value: string) => validateUsername(value),
    }
  );

  // Custom validation for confirmPassword that depends on password
  const validateConfirmPassword = useCallback(() => {
    return validatePasswordMatch(form.values.password, form.values.confirmPassword);
  }, [form.values.password, form.values.confirmPassword]);

  // Password strength meter
  const passwordStrength = useMemo((): PasswordStrength => {
    return getPasswordStrength(form.values.password);
  }, [form.values.password]);

  return {
    ...form,
    validateConfirmPassword,
    passwordStrength,
  };
}

/**
 * Pre-built hook for profile form validation
 */
export function useProfileFormValidation(initialValues: {
  username: string;
  email: string;
  phone?: string;
  website?: string;
}) {
  return useFormValidation(
    initialValues,
    {
      username: (value: string) => validateUsername(value),
      email: (value: string) => validateEmail(value),
      phone: (value: string | undefined) => value ? validatePhone(value) : { isValid: true },
      website: (value: string | undefined) => value ? validateUrl(value) : { isValid: true },
    }
  );
}

export default useFormValidation;
