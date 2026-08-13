export const AUTH_ERROR_PARAMETERS = [
  "error",
  "error_code",
  "error_description",
] as const;

export type AuthErrorDetails = {
  error: string;
  errorCode: string | null;
};

export function validatedAuthError(
  searchParams: URLSearchParams,
): { forwarded: URLSearchParams; details: AuthErrorDetails } | null {
  if (
    [...searchParams.keys()].some(
      (name) =>
        !AUTH_ERROR_PARAMETERS.includes(
          name as (typeof AUTH_ERROR_PARAMETERS)[number],
        ),
    ) ||
    AUTH_ERROR_PARAMETERS.some(
      (name) => searchParams.getAll(name).length > 1,
    )
  ) {
    return null;
  }

  const error = searchParams.get("error");
  const errorCode = searchParams.get("error_code");
  const errorDescription = searchParams.get("error_description");
  if (
    !error ||
    error.length > 128 ||
    (errorCode?.length ?? 0) > 128 ||
    (errorDescription?.length ?? 0) > 512 ||
    !/^[a-z0-9_-]+$/i.test(error) ||
    Boolean(errorCode && !/^[a-z0-9_-]+$/i.test(errorCode))
  ) {
    return null;
  }

  const forwarded = new URLSearchParams({ error });
  if (errorCode) forwarded.set("error_code", errorCode);
  if (errorDescription) forwarded.set("error_description", errorDescription);
  return { forwarded, details: { error, errorCode } };
}

export function authErrorCopy(details: AuthErrorDetails): {
  title: string;
  body: string;
} {
  switch (details.errorCode) {
    case "flow_state_already_used":
      return {
        title: "Sign-in Already Used",
        body: "This sign-in attempt has already been completed. Close this tab and return to Orion to start a new one.",
      };
    case "flow_state_expired":
    case "flow_state_not_found":
      return {
        title: "Sign-in Expired",
        body: "This sign-in attempt is no longer valid. Close this tab and return to Orion to try again.",
      };
    default:
      if (details.error === "access_denied") {
        return {
          title: "Sign-in Cancelled",
          body: "Sign-in was cancelled. Close this tab and return to Orion when you are ready to try again.",
        };
      }
      return {
        title: "Sign-in Failed",
        body: "Sign-in could not be completed. Close this tab and return to Orion to try again.",
      };
  }
}
