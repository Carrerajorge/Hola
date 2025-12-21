import { Router } from "express";
import { runETLAgent, getAvailableCountries, getAvailableIndicators } from "../etl";

export const etlRouter = Router();

etlRouter.get("/config", async (req, res) => {
  try {
    res.json({
      countries: getAvailableCountries(),
      indicators: getAvailableIndicators()
    });
  } catch (error: any) {
    console.error("ETL config error:", error);
    res.status(500).json({ error: "Failed to get ETL config" });
  }
});

etlRouter.post("/run", async (req, res) => {
  try {
    const { countries, indicators, startDate, endDate } = req.body;
    
    if (!countries || !Array.isArray(countries) || countries.length === 0) {
      return res.status(400).json({ error: "Countries array is required" });
    }

    const result = await runETLAgent({
      countries,
      indicators,
      startDate,
      endDate
    });

    if (result.success && result.workbookBuffer) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.workbookBuffer);
    } else {
      res.status(result.success ? 200 : 500).json({
        success: result.success,
        message: result.message,
        summary: result.summary,
        errors: result.errors
      });
    }
  } catch (error: any) {
    console.error("ETL API error:", error);
    res.status(500).json({ 
      error: "ETL pipeline failed",
      details: error.message 
    });
  }
});
