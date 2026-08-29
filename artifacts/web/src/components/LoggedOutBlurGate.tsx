import type { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PROFILE_ENTRY_PATH } from "@/lib/routes";

type LoggedOutBlurGateProps = {
  children: ReactNode;
  blurred: boolean;
  className?: string;
};

export function LoggedOutBlurGate({
  children,
  blurred,
  className = "",
}: LoggedOutBlurGateProps) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        className={
          blurred
            ? "pointer-events-none select-none blur-[4px]"
            : undefined
        }
        aria-hidden={blurred || undefined}
      >
        {children}
      </div>
      {blurred && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(15,17,21,0.45)] p-6">
          <div className="max-w-md text-center">
            <p className="mb-4 text-sm font-medium text-white md:text-base">
              Create a free profile to unlock the full HookahBuddys experience.
            </p>
            <Link href={PROFILE_ENTRY_PATH}>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                Create Free Profile
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}