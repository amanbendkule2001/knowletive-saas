"use client";

import { useState } from "react";

export function SyllabusNameCodeFields() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [isManual, setIsManual] = useState(false);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!isManual) {
      const slug = val
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 20);
      setCode(slug ? (slug.startsWith("SYL-") ? slug : `SYL-${slug}`) : "");
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label htmlFor="name" className="label text-xs">Syllabus Title *</label>
        <input
          id="name"
          name="name"
          required
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="e.g. Class 10 Physics (CBSE)"
          className="input text-xs w-full mt-1"
        />
      </div>

      <div>
        <label htmlFor="code" className="label text-xs">Syllabus Code *</label>
        <input
          id="code"
          name="code"
          required
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setIsManual(true);
          }}
          placeholder="e.g. SYL-PHY-10A"
          className="input font-mono uppercase text-xs w-full mt-1"
        />
        <p className="text-[11px] text-muted mt-1">
          Auto-generated suggestion. You can customize anytime.
        </p>
      </div>
    </div>
  );
}
