import { useEffect } from "react";
import { useGetCurrentUser, usePresenceHeartbeat } from "@workspace/api-client-react";

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

/**
 * Sends a lightweight presence heartbeat while the user is logged in so the
 * "Online Now" sidebar reflects real activity.
 */
export function usePresenceHeartbeatLoop() {
  const { data: session } = useGetCurrentUser();
  const heartbeat = usePresenceHeartbeat();
  const loggedIn = !!session?.user;
  const { mutate } = heartbeat;

  useEffect(() => {
    if (!loggedIn) return;
    mutate(undefined as never);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        mutate(undefined as never);
      }
    }, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [loggedIn, mutate]);
}
