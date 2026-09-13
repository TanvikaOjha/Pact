"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { sepolia } from "viem/chains";
import { Component, type ReactNode } from "react";

class PrivyErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Privy init failed, falling back to dev auth:", error);
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export default function PrivyWrapper({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <>{children}</>;
  return (
    <PrivyErrorBoundary fallback={<>{children}</>}>
      <PrivyProvider
        appId={appId}
      config={{
        // Both a magic-link email login and "connect an existing wallet"
        // (MetaMask, WalletConnect, Coinbase Wallet, etc.) show up in the
        // same Privy modal. Users without a wallet get one created for them.
        loginMethods: ["email", "wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          solana: { createOnLogin: "off" },
        },
        defaultChain: sepolia,
        supportedChains: [sepolia],
      }}
      >
        {children}
      </PrivyProvider>
    </PrivyErrorBoundary>
  );
}
