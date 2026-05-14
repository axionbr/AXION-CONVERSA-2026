import { Router } from 'express';
import authRoutes from './auth';
import userRoutes from './users';
import storeRoutes from './stores';
import contactRoutes from './contacts';
import leadRoutes from './leads';
import conversationRoutes from './conversations';
import tagRoutes from './tags';
import customFieldRoutes from './customFields';
import dashboardRoutes from './dashboard';
import aiRoutes from './ai';
import zapiRoutes from './zapi';
import webhookRoutes from './webhooks';
import flowRoutes from './flows';
import settingsRoutes from './settings';
import handoffRoutes from './handoff';
import debugRoutes from './debug';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/stores', storeRoutes);
router.use('/contacts', contactRoutes);
router.use('/leads', leadRoutes);
router.use('/conversations', conversationRoutes);
router.use('/tags', tagRoutes);
router.use('/custom-fields', customFieldRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/ai', aiRoutes);
router.use('/zapi', zapiRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/flows', flowRoutes);
router.use('/settings', settingsRoutes);
router.use('/handoff', handoffRoutes);
router.use('/debug', debugRoutes);

export default router;
