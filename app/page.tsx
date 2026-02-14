"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Container } from "@/components/container";
import { Heading } from "@/components/heading";
import { SubHeading } from "@/components/subheading";
import { Button } from "@/components/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Phone,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Wrench,
  AlertCircle,
  RotateCcw,
} from "lucide-react";

type DemoState = "form" | "confirm" | "calling" | "completed";

interface FormData {
  name: string;
  company: string;
  phone: string;
  email: string;
}

interface CallData {
  status: string;
  transcript: string;
  messages: Array<{
    role: string;
    message?: string;
    content?: string;
    time?: number;
  }>;
  recordingUrl: string | null;
  stereoRecordingUrl: string | null;
  analysis: {
    summary?: string;
    successEvaluation?: string;
    structuredData?: Record<string, unknown>;
  } | null;
  duration: number | null;
  endedReason: string | null;
  costs: Array<{ type: string; amount: number }> | null;
}

interface PipelineStep {
  step: string;
  status: "ok" | "error" | "skipped";
  detail: string;
  timestamp: string;
}

interface Improvement {
  callId?: string;
  failures?: string[];
  changes?: string[];
  toolsCreated?: string[];
  workflowsCreated?: string[];
  rawAnalysis?: string;
  pipelineLog?: PipelineStep[];
}

const DEFAULT_SCENARIO = {
  value: "logistics-demo",
  label: "Logistics AI Agent Demo",
  description:
    "Our AI agent will call you to help coordinate container shipments from Jebel Ali port. It starts with limited capabilities and improves itself after each interaction.",
};

const fadeVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

export default function DemoPage() {
  const [state, setState] = useState<DemoState>("form");
  const [form, setForm] = useState<FormData>({
    name: "",
    company: "",
    phone: "",
    email: "",
  });
  const [callId, setCallId] = useState<string | null>(null);
  const [callData, setCallData] = useState<CallData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [improvements, setImprovements] = useState<Improvement[]>([]);
  const [dynamicTools, setDynamicTools] = useState<
    Array<{ name: string; description: string }>
  >([]);
  const [improvementsLoading, setImprovementsLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const improvePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedScenario = DEFAULT_SCENARIO;

  const updateField = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          scenario: DEFAULT_SCENARIO.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create call");
      setCallId(data.callId);
      setState("calling");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  // Poll call status
  const pollCallStatus = useCallback(async () => {
    if (!callId) return;
    try {
      const res = await fetch(`/api/demo/${callId}`);
      const data = await res.json();
      if (!res.ok) return;
      setCallData(data);
      if (data.status === "ended") {
        setState("completed");
      }
    } catch {
      // ignore polling errors
    }
  }, [callId]);

  // Start polling + timer when calling
  useEffect(() => {
    if (state === "calling" && callId) {
      setElapsed(0);
      timerRef.current = setInterval(
        () => setElapsed((prev) => prev + 1),
        1000,
      );
      pollRef.current = setInterval(pollCallStatus, 3000);
      pollCallStatus();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state, callId, pollCallStatus]);

  // Stop timers when completed
  useEffect(() => {
    if (state === "completed") {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    }
  }, [state]);

  // Poll improvements after call ends
  useEffect(() => {
    if (state !== "completed" || !callId) return;
    setImprovementsLoading(true);
    let attempts = 0;
    const maxAttempts = 20; // 60s with 3s interval

    const pollImprovements = async () => {
      attempts++;
      try {
        const res = await fetch(
          `/api/demo/improvements?callId=${callId}`,
        );
        const data = await res.json();
        if (
          data.improvements?.length > 0 ||
          data.dynamicTools?.length > 0
        ) {
          setImprovements(data.improvements);
          setDynamicTools(data.dynamicTools);
          setImprovementsLoading(false);
          if (improvePollRef.current) clearInterval(improvePollRef.current);
        } else if (attempts >= maxAttempts) {
          setImprovementsLoading(false);
          if (improvePollRef.current) clearInterval(improvePollRef.current);
        }
      } catch {
        if (attempts >= maxAttempts) {
          setImprovementsLoading(false);
          if (improvePollRef.current) clearInterval(improvePollRef.current);
        }
      }
    };

    improvePollRef.current = setInterval(pollImprovements, 3000);
    pollImprovements();

    return () => {
      if (improvePollRef.current) clearInterval(improvePollRef.current);
    };
  }, [state, callId]);

  const resetDemo = () => {
    setState("form");
    setForm({
      name: "",
      company: "",
      phone: "",
      email: "",
    });
    setCallId(null);
    setCallData(null);
    setError(null);
    setElapsed(0);
    setImprovements([]);
    setDynamicTools([]);
    setImprovementsLoading(false);
    setResetSuccess(false);
  };

  const handleResetBaseline = async () => {
    setResetting(true);
    setResetSuccess(false);
    setError(null);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset");
      setResetSuccess(true);
      setTimeout(() => setResetSuccess(false), 3000);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to reset to baseline",
      );
    } finally {
      setResetting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const canSubmit = form.name && form.phone && !submitting;

  return (
    <Container className="min-h-[80vh] px-4 py-8 md:py-16">
      <AnimatePresence mode="wait">
        {/* ─── STATE 1: FORM ─── */}
        {state === "form" && (
          <motion.div
            key="form"
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="mx-auto max-w-xl"
          >
            <Heading className="mb-2">Try the AI Agent</Heading>
            <SubHeading className="mb-8">
              Fill in your details and our logistics AI agent will call you
              to demonstrate its capabilities.
            </SubHeading>

            <div className="space-y-5">
              <div>
                <Label htmlFor="name">Full Name *</Label>
                <Input
                  id="name"
                  placeholder="John Doe"
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  className="mt-1.5"
                />
              </div>

              <div>
                <Label htmlFor="company">Company</Label>
                <Input
                  id="company"
                  placeholder="Acme Logistics"
                  value={form.company}
                  onChange={(e) => updateField("company", e.target.value)}
                  className="mt-1.5"
                />
              </div>

              <div className="rounded-lg border border-brand/20 bg-brand/5 p-4 dark:border-brand/30 dark:bg-brand/10">
                <p className="text-sm font-medium">{selectedScenario.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedScenario.description}
                </p>
              </div>

              <div>
                <Label htmlFor="phone">Phone Number *</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+971 50 123 4567"
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  className="mt-1.5"
                />
              </div>

              <div>
                <Label htmlFor="email">Email (optional)</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john@acme.com"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  className="mt-1.5"
                />
              </div>

              {error && (
                <p className="flex items-center gap-1.5 text-sm text-red-500">
                  <AlertCircle className="size-4" />
                  {error}
                </p>
              )}

              <Button
                onClick={() => setState("confirm")}
                disabled={!canSubmit}
                className="w-full disabled:opacity-50"
              >
                Review &amp; Call
              </Button>

              {/* Reset to Baseline */}
              <div className="border-divide rounded-xl border p-4 dark:border-neutral-700">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      Reset Agent to Baseline
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Wipe all improvements, tools, and history. Start
                      fresh for a new demo run.
                    </p>
                  </div>
                  <button
                    onClick={handleResetBaseline}
                    disabled={resetting}
                    className="ml-4 flex shrink-0 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
                  >
                    {resetting ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : resetSuccess ? (
                      <CheckCircle2 className="size-3 text-green-500" />
                    ) : (
                      <RotateCcw className="size-3" />
                    )}
                    {resetting
                      ? "Resetting..."
                      : resetSuccess
                        ? "Done!"
                        : "Reset"}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ─── STATE 2: CONFIRM ─── */}
        {state === "confirm" && (
          <motion.div
            key="confirm"
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="mx-auto max-w-xl"
          >
            <Heading className="mb-2 text-2xl md:text-3xl lg:text-4xl">
              Confirm Your Details
            </Heading>
            <SubHeading className="mb-8">
              We&apos;ll call you at the number below. Make sure it&apos;s
              correct.
            </SubHeading>

            <div className="border-divide rounded-xl border p-6 dark:border-neutral-700">
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="font-medium">{form.name}</dd>
                </div>
                {form.company && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Company</dt>
                    <dd className="font-medium">{form.company}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="font-medium">{form.phone}</dd>
                </div>
                {form.email && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="font-medium">{form.email}</dd>
                  </div>
                )}
              </dl>
            </div>

            {error && (
              <p className="mt-4 flex items-center gap-1.5 text-sm text-red-500">
                <AlertCircle className="size-4" />
                {error}
              </p>
            )}

            <div className="mt-6 flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setState("form")}
                className="flex-1"
              >
                <span className="flex items-center justify-center gap-1.5">
                  <ArrowLeft className="size-4" />
                  Go Back
                </span>
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <Loader2 className="size-4 animate-spin" />
                    Connecting...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-1.5">
                    <Phone className="size-4" />
                    Confirm &amp; Call
                  </span>
                )}
              </Button>
            </div>
          </motion.div>
        )}

        {/* ─── STATE 3: CALLING ─── */}
        {state === "calling" && (
          <motion.div
            key="calling"
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="mx-auto flex max-w-md flex-col items-center text-center"
          >
            <div className="relative mb-6">
              <div className="absolute inset-0 animate-ping rounded-full bg-brand/20" />
              <div className="absolute inset-0 animate-pulse rounded-full bg-brand/10" />
              <div className="relative flex size-20 items-center justify-center rounded-full bg-brand text-white">
                <Phone className="size-8" />
              </div>
            </div>

            <Heading className="mb-1 text-2xl md:text-3xl">
              Calling {form.name}
            </Heading>
            <p className="text-muted-foreground mb-4 text-sm">
              {form.phone}
            </p>

            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-green-50 px-4 py-1.5 text-sm font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-green-500" />
              </span>
              {callData?.status === "in-progress"
                ? "In Progress"
                : callData?.status === "ringing"
                  ? "Ringing"
                  : "Queued"}
            </div>

            <p className="text-3xl font-mono font-light tabular-nums">
              {formatTime(elapsed)}
            </p>
          </motion.div>
        )}

        {/* ─── STATE 4: COMPLETED ─── */}
        {state === "completed" && callData && (
          <motion.div
            key="completed"
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="mx-auto max-w-2xl space-y-6"
          >
            {/* Summary Card */}
            <div className="border-divide rounded-xl border p-6 dark:border-neutral-700">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Call Completed</h2>
                  <p className="text-muted-foreground text-sm">
                    {form.name} &middot; {form.phone}
                    {form.company && ` &middot; ${form.company}`}
                  </p>
                </div>
                <StatusBadge analysis={callData.analysis} />
              </div>
              <div className="mt-4 flex flex-wrap gap-4 text-sm">
                {callData.duration != null && (
                  <div>
                    <span className="text-muted-foreground">Duration: </span>
                    <span className="font-medium">
                      {formatTime(callData.duration)}
                    </span>
                  </div>
                )}
                {callData.endedReason && (
                  <div>
                    <span className="text-muted-foreground">
                      Ended reason:{" "}
                    </span>
                    <span className="font-medium">
                      {callData.endedReason}
                    </span>
                  </div>
                )}
              </div>
              {callData.analysis?.summary && (
                <p className="text-muted-foreground mt-3 text-sm">
                  {callData.analysis.summary}
                </p>
              )}
            </div>

            {/* Conversation */}
            {callData.messages && callData.messages.length > 0 ? (
              <div className="border-divide rounded-xl border p-6 dark:border-neutral-700">
                <h3 className="mb-4 font-semibold">Conversation</h3>
                <div className="space-y-3">
                  {callData.messages
                    .filter(
                      (m) =>
                        (m.role === "assistant" || m.role === "bot" || m.role === "user") &&
                        (m.message || m.content),
                    )
                    .map((m, i) => {
                      const isUser = m.role === "user";
                      return (
                        <div
                          key={i}
                          className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
                              isUser
                                ? "bg-brand text-white"
                                : "bg-gray-100 text-gray-900 dark:bg-neutral-800 dark:text-gray-100"
                            }`}
                          >
                            {m.message || m.content}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ) : callData.transcript ? (
              <div className="border-divide rounded-xl border p-6 dark:border-neutral-700">
                <h3 className="mb-4 font-semibold">Transcript</h3>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {callData.transcript}
                </p>
              </div>
            ) : null}

            {/* Recording */}
            {(callData.recordingUrl || callData.stereoRecordingUrl) && (
              <div className="border-divide rounded-xl border p-6 dark:border-neutral-700">
                <h3 className="mb-4 font-semibold">Recording</h3>
                <audio
                  controls
                  className="w-full"
                  src={
                    callData.stereoRecordingUrl || callData.recordingUrl || ""
                  }
                />
              </div>
            )}

            {/* Tool Calls */}
            {callData.messages &&
              callData.messages.filter(
                (m) => m.role === "tool_calls" || m.role === "tool_call_result",
              ).length > 0 && (
                <div className="border-divide rounded-xl border p-6 dark:border-neutral-700">
                  <h3 className="mb-4 font-semibold">Tool Calls</h3>
                  <div className="space-y-2">
                    {callData.messages
                      .filter(
                        (m) =>
                          m.role === "tool_calls" ||
                          m.role === "tool_call_result",
                      )
                      .map((m, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-sm"
                        >
                          <CheckCircle2 className="size-4 shrink-0 text-green-500" />
                          <span className="font-mono text-xs">
                            {m.message || m.content || "Tool called"}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

            {/* Self-Improvement Results */}
            <div className="border-divide rounded-xl border p-6 dark:border-neutral-700">
              <h3 className="mb-4 font-semibold">
                Self-Improvement Engine
              </h3>
              {improvementsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Agent is analyzing the call and improving itself...
                </div>
              ) : improvements.length > 0 || dynamicTools.length > 0 ? (
                <div className="space-y-4">
                  {improvements.map((imp, idx) => (
                    <div key={idx} className="space-y-4">
                      {/* Pipeline Log */}
                      {imp.pipelineLog && imp.pipelineLog.length > 0 && (
                        <div>
                          <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                            Pipeline Steps
                          </h4>
                          <div className="space-y-1 rounded-lg bg-gray-50 p-3 dark:bg-neutral-900">
                            {imp.pipelineLog.map((step, i) => (
                              <div
                                key={i}
                                className="flex items-start gap-2 font-mono text-xs"
                              >
                                <span className="shrink-0 pt-0.5">
                                  {step.status === "ok"
                                    ? "✅"
                                    : step.status === "error"
                                      ? "❌"
                                      : "⏭️"}
                                </span>
                                <span className="text-muted-foreground">
                                  [{step.step}]
                                </span>
                                <span className="break-all">{step.detail}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Failures */}
                      {imp.failures && imp.failures.length > 0 && (
                        <div>
                          <h4 className="mb-2 text-sm font-medium text-red-600 dark:text-red-400">
                            Failures Identified
                          </h4>
                          <div className="space-y-1.5">
                            {imp.failures.map((f, i) => (
                              <div
                                key={`f-${i}`}
                                className="flex items-start gap-2 text-sm"
                              >
                                <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
                                <span>{f}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Changes Applied */}
                      {imp.changes && imp.changes.length > 0 && (
                        <div>
                          <h4 className="mb-2 text-sm font-medium text-green-600 dark:text-green-400">
                            Changes Applied
                          </h4>
                          <div className="space-y-1.5">
                            {imp.changes.map((c, i) => (
                              <div
                                key={`c-${i}`}
                                className="flex items-start gap-2 text-sm"
                              >
                                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-500" />
                                <span>{c}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Tools Created */}
                      {imp.toolsCreated && imp.toolsCreated.length > 0 && (
                        <div>
                          <h4 className="mb-2 text-sm font-medium text-brand">
                            Tools Created
                          </h4>
                          <div className="space-y-1.5">
                            {imp.toolsCreated.map((t, i) => (
                              <div
                                key={`t-${i}`}
                                className="flex items-center gap-2 text-sm"
                              >
                                <Wrench className="size-4 shrink-0 text-brand" />
                                <span className="font-medium">{t}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Workflows Created */}
                      {imp.workflowsCreated &&
                        imp.workflowsCreated.length > 0 && (
                          <div>
                            <h4 className="mb-2 text-sm font-medium text-purple-600 dark:text-purple-400">
                              n8n Workflows Deployed
                            </h4>
                            <div className="space-y-1.5">
                              {imp.workflowsCreated.map((w, i) => (
                                <div
                                  key={`w-${i}`}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <CheckCircle2 className="size-4 shrink-0 text-purple-500" />
                                  <span className="font-mono text-xs break-all">
                                    {w}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                      {/* Raw Analysis — AI thinking process */}
                      {imp.rawAnalysis && (
                        <details className="group">
                          <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                            View AI Analysis (full reasoning)
                          </summary>
                          <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-gray-50 p-3 font-mono text-xs whitespace-pre-wrap dark:bg-neutral-900">
                            {imp.rawAnalysis}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}

                  {/* Dynamic tools from health */}
                  {dynamicTools.length > 0 && (
                    <div>
                      <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                        Active Dynamic Tools
                      </h4>
                      {dynamicTools.map((t, i) => (
                        <div
                          key={`dt-${i}`}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Wrench className="size-4 shrink-0 text-brand" />
                          <span>
                            <span className="font-medium">{t.name}</span>{" "}
                            &mdash; {t.description}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No improvements triggered for this call yet. The agent
                  analyzes each call after it ends and self-improves.
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button onClick={resetDemo}>Start New Demo</Button>
              <button
                onClick={async () => {
                  await handleResetBaseline();
                  resetDemo();
                }}
                disabled={resetting}
                className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-6 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
              >
                {resetting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                Reset to Baseline &amp; Restart
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Container>
  );
}

function StatusBadge({
  analysis,
}: {
  analysis: CallData["analysis"];
}) {
  const evaluation = analysis?.successEvaluation;
  let color = "bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-gray-300";
  let label = "Completed";

  if (evaluation === "true" || evaluation === "passed") {
    color = "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300";
    label = "Passed";
  } else if (evaluation === "false" || evaluation === "failed") {
    color = "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300";
    label = "Failed";
  }

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}
