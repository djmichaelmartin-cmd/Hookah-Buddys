import { ApiError } from "@workspace/api-client-react";

/**
 * Returns true when a 402 error means "payment must go through checkout"
 * (body carries `checkoutRequired: true`) rather than "not enough credits".
 * The two cases need different UI: checkout redirect vs. buy-credits dialog.
 */
export function isCheckoutRequired(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 402 &&
    !!err.data &&
    typeof err.data === "object" &&
    "checkoutRequired" in err.data &&
    (err.data as { checkoutRequired?: unknown }).checkoutRequired === true
  );
}
