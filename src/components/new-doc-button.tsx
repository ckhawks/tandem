"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function NewDocButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      size="sm"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        const res = await fetch("/api/documents", { method: "POST" });
        setLoading(false);
        if (res.ok) {
          const { id } = await res.json();
          router.push(`/d/${id}`);
        }
      }}
    >
      <Plus className="h-4 w-4" /> New
    </Button>
  );
}
