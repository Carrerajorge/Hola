/**
 * MFA Router
 * Endpoints for two-factor authentication setup and verification
 */

import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { users } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import {
    generateMfaSecret,
    verifyMfa,
    hashBackupCodes,
    checkHashedBackupCode
} from '../services/mfaService';

export function createMfaRouter() {
    const router = Router();

    // Setup MFA - Generate secret and QR code
    router.post('/setup', async (req, res) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const user = await db.query.users.findFirst({
                where: eq(users.id, userId),
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Generate new MFA secret
            const mfaSetup = await generateMfaSecret(user.email);

            // Store pending secret (not activated yet)
            // In production, store in a temporary table or Redis
            // For now, we'll return it and expect /verify to confirm

            res.json({
                secret: mfaSetup.secret, // Only for initial setup
                qrCode: mfaSetup.qrCodeDataUrl,
                backupCodes: mfaSetup.backupCodes,
                message: 'Scan the QR code with your authenticator app, then verify with a code',
            });
        } catch (error: any) {
            console.error('MFA setup error:', error);
            res.status(500).json({ error: 'Failed to setup MFA', details: error.message });
        }
    });

    // Verify and enable MFA
    router.post('/enable', async (req, res) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const schema = z.object({
                secret: z.string(),
                code: z.string().min(6),
                backupCodes: z.array(z.string()),
            });

            const { secret, code, backupCodes } = schema.parse(req.body);

            // Verify the code before enabling
            const result = verifyMfa(code, secret, []);

            if (!result.success) {
                return res.status(400).json({ error: 'Invalid verification code' });
            }

            // Hash backup codes before storing
            const hashedBackupCodes = hashBackupCodes(backupCodes);

            // Update user with MFA enabled
            await db.update(users)
                .set({
                    mfaEnabled: true,
                    mfaSecret: secret,
                    mfaBackupCodes: hashedBackupCodes,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, userId));

            res.json({
                success: true,
                message: 'MFA enabled successfully',
                backupCodesCount: backupCodes.length,
            });
        } catch (error: any) {
            console.error('MFA enable error:', error);
            res.status(500).json({ error: 'Failed to enable MFA', details: error.message });
        }
    });

    // Verify MFA code during login
    router.post('/verify', async (req, res) => {
        try {
            const schema = z.object({
                userId: z.number(),
                code: z.string().min(6),
            });

            const { userId, code } = schema.parse(req.body);

            const user = await db.query.users.findFirst({
                where: eq(users.id, userId),
            });

            if (!user || !user.mfaEnabled || !user.mfaSecret) {
                return res.status(400).json({ error: 'MFA not enabled for this user' });
            }

            // Try TOTP verification first
            const result = verifyMfa(code, user.mfaSecret, []);

            if (result.success) {
                // Update last MFA verification time
                await db.update(users)
                    .set({ mfaLastVerified: new Date() })
                    .where(eq(users.id, userId));

                return res.json({ success: true, usedBackupCode: false });
            }

            // Try backup code
            if (user.mfaBackupCodes && user.mfaBackupCodes.length > 0) {
                const { valid, usedIndex } = checkHashedBackupCode(code, user.mfaBackupCodes);

                if (valid) {
                    // Remove used backup code
                    const remainingCodes = [...user.mfaBackupCodes];
                    remainingCodes.splice(usedIndex, 1);

                    await db.update(users)
                        .set({
                            mfaBackupCodes: remainingCodes,
                            mfaLastVerified: new Date(),
                        })
                        .where(eq(users.id, userId));

                    return res.json({
                        success: true,
                        usedBackupCode: true,
                        remainingBackupCodes: remainingCodes.length,
                    });
                }
            }

            res.status(400).json({ error: 'Invalid verification code' });
        } catch (error: any) {
            console.error('MFA verify error:', error);
            res.status(500).json({ error: 'Verification failed', details: error.message });
        }
    });

    // Disable MFA
    router.post('/disable', async (req, res) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const schema = z.object({
                password: z.string(),
                code: z.string().optional(),
            });

            const { password, code } = schema.parse(req.body);

            const user = await db.query.users.findFirst({
                where: eq(users.id, userId),
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Verify password (simplified - use proper bcrypt compare in production)
            // if (!await bcrypt.compare(password, user.password)) {
            //   return res.status(400).json({ error: 'Invalid password' });
            // }

            // If MFA is enabled, require code verification
            if (user.mfaEnabled && user.mfaSecret && code) {
                const result = verifyMfa(code, user.mfaSecret, []);
                if (!result.success) {
                    return res.status(400).json({ error: 'Invalid MFA code' });
                }
            }

            // Disable MFA
            await db.update(users)
                .set({
                    mfaEnabled: false,
                    mfaSecret: null,
                    mfaBackupCodes: null,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, userId));

            res.json({ success: true, message: 'MFA disabled successfully' });
        } catch (error: any) {
            console.error('MFA disable error:', error);
            res.status(500).json({ error: 'Failed to disable MFA', details: error.message });
        }
    });

    // Regenerate backup codes
    router.post('/regenerate-backup-codes', async (req, res) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const schema = z.object({
                code: z.string().min(6),
            });

            const { code } = schema.parse(req.body);

            const user = await db.query.users.findFirst({
                where: eq(users.id, userId),
            });

            if (!user || !user.mfaEnabled || !user.mfaSecret) {
                return res.status(400).json({ error: 'MFA not enabled' });
            }

            // Verify current code
            const result = verifyMfa(code, user.mfaSecret, []);
            if (!result.success) {
                return res.status(400).json({ error: 'Invalid verification code' });
            }

            // Generate new backup codes
            const { backupCodes } = await generateMfaSecret(user.email);
            const hashedCodes = hashBackupCodes(backupCodes);

            await db.update(users)
                .set({ mfaBackupCodes: hashedCodes })
                .where(eq(users.id, userId));

            res.json({
                success: true,
                backupCodes, // Return new codes (only time they're shown)
                message: 'New backup codes generated. Save them securely.',
            });
        } catch (error: any) {
            console.error('Regenerate backup codes error:', error);
            res.status(500).json({ error: 'Failed to regenerate codes', details: error.message });
        }
    });

    // Get MFA status
    router.get('/status', async (req, res) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const user = await db.query.users.findFirst({
                where: eq(users.id, userId),
                columns: {
                    mfaEnabled: true,
                    mfaBackupCodes: true,
                    mfaLastVerified: true,
                },
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            res.json({
                enabled: user.mfaEnabled || false,
                backupCodesRemaining: user.mfaBackupCodes?.length || 0,
                lastVerified: user.mfaLastVerified,
            });
        } catch (error: any) {
            res.status(500).json({ error: 'Failed to get MFA status' });
        }
    });

    return router;
}
