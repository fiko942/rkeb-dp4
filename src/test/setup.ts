import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

export const mockAppRouter = {
  push: vi.fn(),
  refresh: vi.fn()
};

vi.mock("next/navigation", () => ({
  useRouter: () => mockAppRouter,
  redirect: vi.fn()
}));

afterEach(() => {
  mockAppRouter.push.mockReset();
  mockAppRouter.refresh.mockReset();
  vi.restoreAllMocks();
});
