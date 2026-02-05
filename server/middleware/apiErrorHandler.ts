import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Logger } from "../lib/logger";

// RFC 7807 Problem Details
interface ProblemDetails {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance?: string;
    errors?: Record<string, string[]>;
    [key: string]: any;
}

export const apiErrorHandler = (
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    // If headers are already sent, delegate to default Express handler
    if (res.headersSent) {
        return next(err);
    }

    const path = req.path;
    const method = req.method;
    const traceId = res.locals?.traceId || res.locals?.requestId;
    const isProduction = process.env.NODE_ENV === "production";

    // Default Error Status and Message
    let status = err.status || err.statusCode || 500;
    let title = "Internal Server Error";
    const rawDetail = err?.message || "An unexpected error occurred.";
    let detail = rawDetail;
    let errors: Record<string, string[]> | undefined;

    // Handle Zod Validation Errors
    if (err instanceof ZodError) {
        status = 400;
        title = "Validation Error";
        detail = "The request parameters failed validation.";
        errors = err.flatten().fieldErrors as Record<string, string[]>;
    } else if (status === 400) {
        title = "Bad Request";
    } else if (status === 401) {
        title = "Unauthorized";
    } else if (status === 403) {
        title = "Forbidden";
    } else if (status === 404) {
        title = "Not Found";
    } else if (status === 429) {
        title = "Too Many Requests";
    }

    // Log strict errors
    if (status >= 500) {
        Logger.error(`[APIErrorHandler] [${method}] ${path} - ${title}: ${rawDetail}`, err);
    } else {
        Logger.warn(`[APIErrorHandler] [${method}] ${path} - ${title}: ${detail}`);
    }

    // Do not leak internal error details in production.
    if (isProduction && status >= 500) {
        detail = "An unexpected error occurred.";
    }

    // Construct Response
    const problem: ProblemDetails = {
        type: "about:blank",
        title,
        status,
        detail,
        instance: path,
    };

    if (traceId) {
        problem.traceId = traceId;
    }

    if (errors) {
        problem.errors = errors;
    }

    // Include stack trace in development
    if (!isProduction && status >= 500) {
        problem.stack = err.stack;
    }

    res.status(status).json(problem);
};
