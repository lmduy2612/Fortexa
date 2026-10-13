import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(() => "/dashboard"),
  useRouter: vi.fn(() => ({ push: vi.fn(), refresh: vi.fn() })),
  useAuthSession: vi.fn(() => ({
    wallet: null,
    role: null,
    loading: false,
  })),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
  useRouter: mocks.useRouter,
}));

vi.mock("@/lib/auth/use-auth-session", () => ({
  useAuthSession: mocks.useAuthSession,
}));

vi.mock("@/components/app-workspace-background", () => ({
  AppWorkspaceBackground: () => null,
}));

vi.mock("next/image", () => ({
  default: (props: any) => <img alt={props.alt ?? ""} {...props} />,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, className, ...rest }: any) => (
    <a
      href={href}
      className={className}
      data-prefetch={prefetch !== undefined ? String(prefetch) : undefined}
      {...rest}
    >
      {children}
    </a>
  ),
}));

import { AppShell } from "@/components/app-shell";

describe("AppShell role-based navigation (#272)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FORTEXA_OPERATOR_WALLETS;
    delete process.env.FORTEXA_SIGNER_WALLETS;
    delete process.env.FORTEXA_VIEWER_WALLETS;
  });

  it("renders pay navigation and hides policy navigation for a signer", () => {
    mocks.useAuthSession.mockReturnValue({
      wallet: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      role: "signer",
      loading: false,
    });

    const markup = renderToStaticMarkup(<AppShell><div>Page Content</div></AppShell>);

    // Signer sees Pay link
    expect(markup).toContain('href="/pay"');
    expect(markup).toContain("Pay");

    // Signer does not see Policy link
    expect(markup).not.toContain('href="/policies"');
    expect(markup).not.toContain("Policy");

    // Pay link does not prefetch
    expect(markup).toMatch(/<a[^>]*href="\/pay"[^>]*data-prefetch="false"|<a[^>]*data-prefetch="false"[^>]*href="\/pay"/);
  });

  it("renders policy navigation and hides pay navigation for an operator", () => {
    mocks.useAuthSession.mockReturnValue({
      wallet: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      role: "operator",
      loading: false,
    });

    const markup = renderToStaticMarkup(<AppShell><div>Page Content</div></AppShell>);

    // Operator sees Policy link
    expect(markup).toContain('href="/policies"');
    expect(markup).toContain("Policy");

    // Operator does not see Pay link
    expect(markup).not.toContain('href="/pay"');

    // Policy link does not prefetch
    expect(markup).toMatch(/<a[^>]*href="\/policies"[^>]*data-prefetch="false"|<a[^>]*data-prefetch="false"[^>]*href="\/policies"/);
  });

  it("renders neither pay nor policy navigation when signed out", () => {
    mocks.useAuthSession.mockReturnValue({
      wallet: null,
      role: null,
      loading: false,
    });

    const markup = renderToStaticMarkup(<AppShell><div>Page Content</div></AppShell>);

    expect(markup).not.toContain('href="/pay"');
    expect(markup).not.toContain('href="/policies"');
  });

  it("renders neither pay nor policy navigation for a viewer session", () => {
    mocks.useAuthSession.mockReturnValue({
      wallet: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      role: "viewer",
      loading: false,
    });

    const markup = renderToStaticMarkup(<AppShell><div>Page Content</div></AppShell>);

    expect(markup).not.toContain('href="/pay"');
    expect(markup).not.toContain('href="/policies"');
  });

  it("renders both pay and policy navigation for a dual-role wallet", () => {
    const dualWallet = "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
    process.env.FORTEXA_OPERATOR_WALLETS = dualWallet;
    process.env.FORTEXA_SIGNER_WALLETS = dualWallet;

    mocks.useAuthSession.mockReturnValue({
      wallet: dualWallet,
      role: null,
      loading: false,
    });

    const markup = renderToStaticMarkup(<AppShell><div>Page Content</div></AppShell>);

    expect(markup).toContain('href="/pay"');
    expect(markup).toContain('href="/policies"');
    expect(markup).toMatch(/<a[^>]*href="\/pay"[^>]*data-prefetch="false"|<a[^>]*data-prefetch="false"[^>]*href="\/pay"/);
    expect(markup).toMatch(/<a[^>]*href="\/policies"[^>]*data-prefetch="false"|<a[^>]*data-prefetch="false"[^>]*href="\/policies"/);
  });
});
