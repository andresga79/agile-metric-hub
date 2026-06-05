import { setAuthTokenGetter } from "@workspace/api-client-react";

export const getAuthToken = () => {
  return localStorage.getItem("auth_token");
};

export const setAuthToken = (token: string | null) => {
  if (token) {
    localStorage.setItem("auth_token", token);
  } else {
    localStorage.removeItem("auth_token");
  }
};

setAuthTokenGetter(getAuthToken);
