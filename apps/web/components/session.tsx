'use client';
import { createContext, useContext } from 'react';
export type Me = { user: { id: string; name: string; email: string; email_verified: boolean; totp_enabled: boolean; platform_role: string }; workspace: { id: string; name: string; kyc_status: string; blocked: boolean; blocked_reason: string | null; support_whatsapp: string | null; support_email: string | null }; workspaces: { id: string; name: string; role: string }[]; role: string; permissions: string[]; gateway: string };
export const MeCtx = createContext<{ me: Me; reload: () => void } | null>(null);
export const useMe = () => useContext(MeCtx)!;
export const can = (me: Me, p: string) => me.permissions.includes(p);
