import React from "react";
import WithAuth from "@/components/WithAuth";

export default function AuthRequiredLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WithAuth>
      {children}
    </WithAuth>
  );
}