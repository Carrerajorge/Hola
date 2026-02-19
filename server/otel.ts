
import { NodeSDK } from "@opentelemetry/sdk-node";

import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";

import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

import { resourceFromAttributes } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";


const OTEL_EXPORTER_OTLP_ENDPOINT =

  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://otel-collector:4318";



const serviceName = process.env.OTEL_SERVICE_NAME || "iliagpt-app";

const serviceVersion = process.env.APP_VERSION || "dev";

const environment = process.env.NODE_ENV || "development";



const metricExporter = new OTLPMetricExporter({

  url: `${OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "")}/v1/metrics`,

});



const sdk = new NodeSDK({

  resource: resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: ...,
    [SemanticResourceAttributes.SERVICE_VERSION]: ...,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: ...,
  }),

  metricReader: new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 10000 }),

  instrumentations: [

    getNodeAutoInstrumentations({

      // reduce noise / overhead if needed later

    }),

  ],

});



// Start telemetry as early as possible

sdk.start().catch((err) => {

  // Don't crash the app if telemetry fails

  console.error("[otel] failed to start", err);

});



// Graceful shutdown

process.on("SIGTERM", async () => {

  try {

    await sdk.shutdown();

  } catch {

    // ignore

  }

});

