import type { SupabaseClient } from "@supabase/supabase-js";

export interface BusinessRow {
  id: string;
  wallet_address: string;
  privy_wallet_id: string;
  ens_subname: string;
  world_session_id: string | null;
  world_verified_at: string | null;
  created_at: string;
}

export interface NewBusiness {
  walletAddress: string;
  privyWalletId: string;
  ensSubname: string;
  worldSessionId: string;
}

export interface BusinessStore {
  findByWallet(walletAddress: string): Promise<BusinessRow | null>;
  findBySubname(ensSubname: string): Promise<BusinessRow | null>;
  findByWorldSession(worldSessionId: string): Promise<BusinessRow | null>;
  insert(business: NewBusiness): Promise<BusinessRow>;
}

function firstRow(rows: BusinessRow[] | null): BusinessRow | null {
  if (rows === null || rows.length === 0) return null;
  const row = rows[0];
  if (row === undefined) return null;
  return row;
}

/** Supabase-backed mirror store. On-chain remains authoritative; rows here are UX cache. */
export function createSupabaseBusinessStore(client: SupabaseClient): BusinessStore {
  return {
    async findByWallet(walletAddress: string): Promise<BusinessRow | null> {
      const result = await client
        .from("businesses")
        .select("*")
        .eq("wallet_address", walletAddress)
        .limit(1)
        .returns<BusinessRow[]>();
      if (result.error) throw new Error(`business lookup failed: ${result.error.message}`);
      return firstRow(result.data);
    },
    async findBySubname(ensSubname: string): Promise<BusinessRow | null> {
      const result = await client
        .from("businesses")
        .select("*")
        .eq("ens_subname", ensSubname)
        .limit(1)
        .returns<BusinessRow[]>();
      if (result.error) throw new Error(`business lookup failed: ${result.error.message}`);
      return firstRow(result.data);
    },
    async findByWorldSession(worldSessionId: string): Promise<BusinessRow | null> {
      const result = await client
        .from("businesses")
        .select("*")
        .eq("world_session_id", worldSessionId)
        .limit(1)
        .returns<BusinessRow[]>();
      if (result.error) throw new Error(`business lookup failed: ${result.error.message}`);
      return firstRow(result.data);
    },
    async insert(business: NewBusiness): Promise<BusinessRow> {
      const result = await client
        .from("businesses")
        .insert({
          wallet_address: business.walletAddress,
          privy_wallet_id: business.privyWalletId,
          ens_subname: business.ensSubname,
          world_session_id: business.worldSessionId,
          world_verified_at: new Date().toISOString(),
        })
        .select()
        .returns<BusinessRow[]>();
      if (result.error) throw new Error(`business insert failed: ${result.error.message}`);
      const row = firstRow(result.data);
      if (row === null) throw new Error("business insert returned no row");
      return row;
    },
  };
}
