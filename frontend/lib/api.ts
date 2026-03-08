const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

export async function apiFetch<T>(path: string): Promise<T> {
  if (!baseUrl) {
    throw new Error("Missing NEXT_PUBLIC_BACKEND_URL");
  }

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || `API error: ${res.status}`);
    }

    return res.json();
  } catch (error) {
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new Error(`Cannot connect to backend at ${baseUrl}. Please ensure the backend server is running.`);
    }
    throw error;
  }
}