import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import {
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
} from "@opentelemetry/sdk-trace-node";
import { env } from "./schemas/env.js";

// Simple helper to parse headers from ENV string if provided (key=value,key2=value2)
const parseHeaders = (headerStr?: string): Record<string, string> => {
  if (!headerStr) return {};
  return headerStr.split(",").reduce(
    (acc, part) => {
      const [key, val] = part.split("=");
      if (key && val) acc[key.trim()] = val.trim();
      return acc;
    },
    {} as Record<string, string>,
  );
};

const otlpExporter = new OTLPTraceExporter({
  url: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  headers: parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
});

const isDevelopment = env.NODE_ENV === "development";
const traceExporter = isDevelopment
  ? new ConsoleSpanExporter()
  : otlpExporter;

const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(env.OTEL_SAMPLING_RATIO),
});

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [SEMRESATTRS_SERVICE_NAME]: env.OTEL_SERVICE_NAME,
    [SEMRESATTRS_SERVICE_VERSION]: env.VERSION,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV,
  }),
  traceExporter,
  sampler: sampler,
  instrumentations: [
    new HttpInstrumentation({
      // We can also filter out health checks if we wanted.
    }),
    new ExpressInstrumentation(),
    new PgInstrumentation(),
  ],
});

// Initialize the SDK and register with the OpenTelemetry API
// this enables the instrumentations to patch the modules
try {
  sdk.start();
  console.log("[backend] OpenTelemetry initialized");
} catch (error) {
  console.error("[backend] Error initializing OpenTelemetry", error);
}

// Graceful shutdown is coordinated centrally by index.ts's SIGTERM/SIGINT
// handler, which calls shutdownTracing() as one step among several — it must
// not call process.exit() itself, or it would race that handler's cleanup.
export async function shutdownTracing(): Promise<void> {
  try {
    await sdk.shutdown();
    console.log("[backend] OpenTelemetry terminated");
  } catch (error) {
    console.error("[backend] Error terminating OpenTelemetry", error);
  }
}

export default sdk;
