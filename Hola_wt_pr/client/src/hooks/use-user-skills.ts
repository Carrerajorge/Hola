import { useState, useEffect, useCallback } from "react";

export interface UserSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  category: "documents" | "data" | "integrations" | "custom";
  enabled: boolean;
  builtIn: false;
  features: string[];
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "sira-user-skills";

export function useUserSkills() {
  const [skills, setSkills] = useState<UserSkill[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSkills(JSON.parse(stored));
      }
    } catch (error) {
      console.error("Error loading user skills:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveSkills = useCallback((newSkills: UserSkill[]) => {
    setSkills(newSkills);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSkills));
    } catch (error) {
      console.error("Error saving user skills:", error);
    }
  }, []);

  const createSkill = useCallback((skill: Omit<UserSkill, "id" | "createdAt" | "updatedAt" | "builtIn">) => {
    const newSkill: UserSkill = {
      ...skill,
      id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      builtIn: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const newSkills = [...skills, newSkill];
    saveSkills(newSkills);
    return newSkill;
  }, [skills, saveSkills]);

  const updateSkill = useCallback((id: string, updates: Partial<Omit<UserSkill, "id" | "createdAt" | "builtIn">>) => {
    const newSkills = skills.map(skill => {
      if (skill.id === id) {
        return {
          ...skill,
          ...updates,
          updatedAt: new Date().toISOString(),
        };
      }
      return skill;
    });
    saveSkills(newSkills);
  }, [skills, saveSkills]);

  const deleteSkill = useCallback((id: string) => {
    const newSkills = skills.filter(skill => skill.id !== id);
    saveSkills(newSkills);
  }, [skills, saveSkills]);

  const toggleSkill = useCallback((id: string) => {
    const newSkills = skills.map(skill => {
      if (skill.id === id) {
        return { ...skill, enabled: !skill.enabled, updatedAt: new Date().toISOString() };
      }
      return skill;
    });
    saveSkills(newSkills);
  }, [skills, saveSkills]);

  const duplicateSkill = useCallback((id: string) => {
    const skill = skills.find(s => s.id === id);
    if (!skill) return null;
    
    const newSkill: UserSkill = {
      ...skill,
      id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: `${skill.name} (copia)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const newSkills = [...skills, newSkill];
    saveSkills(newSkills);
    return newSkill;
  }, [skills, saveSkills]);

  return {
    skills,
    isLoading,
    createSkill,
    updateSkill,
    deleteSkill,
    toggleSkill,
    duplicateSkill,
  };
}
