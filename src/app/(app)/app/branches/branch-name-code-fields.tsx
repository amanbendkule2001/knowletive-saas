"use client";

import { useState } from "react";
import { Field } from "@/components/ui/form-field";

export function BranchNameCodeFields({ tenantSlug = "ORG" }: { tenantSlug?: string }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [collectorCode, setCollectorCode] = useState("");
  const [isCodeManual, setIsCodeManual] = useState(false);
  const [isCollectorManual, setIsCollectorManual] = useState(false);

  const cleanSlug = (tenantSlug || "ORG").toUpperCase().slice(0, 4);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!val.trim()) {
      if (!isCodeManual) setCode("");
      if (!isCollectorManual) setCollectorCode("");
      return;
    }

    let generatedCode = code;
    if (!isCodeManual) {
      // e.g. "Sunrise North Campus" -> "NORTH" or "Sunrise East" -> "EAST"
      const words = val.trim().split(/\s+/).filter(Boolean);
      const significant = words.filter((w) => !/^(campus|branch|wing|center|centre|school|institute)$/i.test(w));
      const targetWord = significant.length > 0 ? significant[significant.length - 1] : words[0];
      generatedCode = targetWord.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10);
      setCode(generatedCode);
    }

    if (!isCollectorManual && generatedCode) {
      setCollectorCode(`COL-${cleanSlug}-${generatedCode}`);
    }
  };

  const handleCodeChange = (val: string) => {
    const upper = val.toUpperCase().replace(/[^A-Z0-9-]+/g, "").slice(0, 15);
    setCode(upper);
    setIsCodeManual(true);
    if (!isCollectorManual && upper) {
      setCollectorCode(`COL-${cleanSlug}-${upper}`);
    }
  };

  return (
    <>
      <Field label="Branch Name" htmlFor="name" required hint="e.g. Sunrise North Campus">
        <input
          id="name"
          name="name"
          className="input"
          placeholder="Sunrise North Campus"
          required
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
        />
      </Field>

      <Field
        label="Branch Code"
        htmlFor="code"
        required
        hint="Auto-generated suggestion. You can customize (e.g. NORTH, EAST)."
      >
        <input
          id="code"
          name="code"
          className="input uppercase font-mono"
          placeholder="NORTH"
          required
          value={code}
          onChange={(e) => handleCodeChange(e.target.value)}
        />
      </Field>

      <Field
        label="Jodo Collector Code"
        htmlFor="collectorCode"
        hint="Auto-generated routing code. You can edit if your payment provider assigned a specific code."
      >
        <input
          id="collectorCode"
          name="collectorCode"
          className="input font-mono"
          placeholder="COL-SUN-NORTH"
          value={collectorCode}
          onChange={(e) => {
            setCollectorCode(e.target.value.toUpperCase());
            setIsCollectorManual(true);
          }}
        />
      </Field>
    </>
  );
}
