"use client";

import { useState } from "react";
import { Field } from "@/components/ui/form-field";

export function SubjectNameCodeFields() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [isManual, setIsManual] = useState(false);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!isManual) {
      if (!val.trim()) {
        setCode("");
        return;
      }
      // Generate concise code: e.g. "Mathematics" -> "MAT-101", "Social Studies" -> "SOC-STU-101"
      const words = val.trim().split(/\s+/).filter(Boolean);
      let prefix = "";
      if (words.length === 1) {
        prefix = words[0].slice(0, 4).toUpperCase();
      } else {
        prefix = words.slice(0, 3).map((w) => w.slice(0, 3).toUpperCase()).join("-");
      }
      setCode(`${prefix}-101`);
    }
  };

  return (
    <>
      <Field label="Subject name" htmlFor="subjectName" required>
        <input
          id="subjectName"
          name="name"
          className="input"
          required
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="e.g. Mathematics"
        />
      </Field>

      <Field
        label="Code"
        htmlFor="subjectCode"
        hint="Auto-generated suggestion. You can customize anytime."
      >
        <input
          id="subjectCode"
          name="code"
          className="input font-mono uppercase"
          placeholder="e.g. MAT-101"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setIsManual(true);
          }}
        />
      </Field>
    </>
  );
}
