"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Server } from "lucide-react";
import { getHealth, HealthResponse } from "@/lib/config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

type State =
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "success"; data: HealthResponse };

export default function BackendHealth() {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
  const [state, setState] = useState<State>({ type: "loading" });

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
    if (!url) {
      return;
    }

    getHealth()
      .then((data) => setState({ type: "success", data }))
      .catch((err: Error) => {
        const errorMessage = err.message || "Unknown error";
        console.error("Backend health check failed:", err);
        setState({ type: "error", message: errorMessage });
      });
  }, []);

  return (
    <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          Backend Connectivity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              Backend URL:
            </span>
            <code className="text-xs bg-muted px-2 py-1 rounded border">
              {backendUrl}
            </code>
          </div>
        </div>

        {state.type === "loading" && (
          <Alert>
            <Spinner className="h-4 w-4" />
            <AlertTitle>Checking connection...</AlertTitle>
            <AlertDescription>
              Connecting to backend service
            </AlertDescription>
          </Alert>
        )}

        {state.type === "error" && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Connection Failed</AlertTitle>
            <AlertDescription>
              {state.message || "Unable to connect to backend service"}
            </AlertDescription>
          </Alert>
        )}

        {state.type === "success" && (
          <Alert>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle>Connected</AlertTitle>
            <AlertDescription>
              <div className="space-y-2 mt-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm">Status:</span>
                  <Badge variant={state.data.status === "ok" ? "default" : "destructive"}>
                    {state.data.status === "ok" ? "Healthy" : "Unhealthy"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">Version:</span>
                  <Badge variant="outline">{state.data.version}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">Uptime:</span>
                  <Badge variant="secondary">{state.data.uptimeSeconds}s</Badge>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}