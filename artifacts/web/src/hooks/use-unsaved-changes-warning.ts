import { useCallback, useEffect, useRef } from "react";
import {
  useBrowserLocation,
  type BrowserLocationHook,
} from "wouter/use-browser-location";

const WARNING_MESSAGE = "You have unsaved Meetup changes. Leave without saving them?";
let navigationBlocker: (() => boolean) | null = null;

export const useGuardedBrowserLocation: BrowserLocationHook = (options) => {
  const [location, navigate] = useBrowserLocation(options);
  const guardedNavigate = useCallback<typeof navigate>((to, navigationOptions) => {
    if (navigationBlocker && !navigationBlocker()) return;
    navigate(to, navigationOptions);
  }, [navigate]);

  return [location, guardedNavigate];
};

export function useUnsavedChangesWarning(hasUnsavedChanges: boolean) {
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  const suppressNextPopRef = useRef(false);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  const allowNavigation = useCallback(() => {
    hasUnsavedChangesRef.current = false;
  }, []);

  useEffect(() => {
    const confirmNavigation = () => (
      !hasUnsavedChangesRef.current || window.confirm(WARNING_MESSAGE)
    );
    navigationBlocker = confirmNavigation;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChangesRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const handlePopState = () => {
      if (suppressNextPopRef.current) {
        suppressNextPopRef.current = false;
        return;
      }
      if (!hasUnsavedChangesRef.current) return;
      if (window.confirm(WARNING_MESSAGE)) {
        hasUnsavedChangesRef.current = false;
        return;
      }

      suppressNextPopRef.current = true;
      window.history.forward();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    return () => {
      if (navigationBlocker === confirmNavigation) navigationBlocker = null;
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  return allowNavigation;
}