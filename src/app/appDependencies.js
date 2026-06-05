'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const moment = require('moment-timezone');
const cron = require('node-cron');
const { google } = require('googleapis');
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    Events,
    REST,
    Routes,
    MessageFlags,
    PermissionFlagsBits,
    Partials
} = require('discord.js');

const {
    CONFIG,
    SHIFT_SCHEDULE,
    MAINTENANCE_WINDOWS
} = require('../config/constants');
const createDashboardStateUtils = require('../utils/dashboardState');
const dataStore = require('../services/dataStore');
const { createAttendanceService } = require('../services/attendanceService');
const createRoleService = require('../services/roleService');
const createDayOffService = require('../services/dayoffService');
const createAdminService = require('../services/adminService');
const createReportRenderer = require('../services/reportRenderer');
const { createDashboardMessageService } = require('../services/dashboardMessageService');
const { createRuntimeHealthService } = require('../services/runtimeHealthService');
const { createPurchaseSheetService } = require('../services/purchaseSheetService');
const { createPayrollLiveSummarySyncService } = require('../services/payrollLiveSummarySyncService');
const { createOpsQueueService } = require('../services/opsQueueService');
const { createPayrollOperationLogService } = require('../services/payrollOperationLogService');
const { createPayrollArchiveService } = require('../services/payrollArchiveService');
const { createRawAttendanceSheetService } = require('../services/rawAttendanceSheetService');
const { createMaintenanceOverrideService } = require('../services/maintenanceOverrideService');
const { collectStatusTransitionWarnings } = require('../services/stateTransitionPolicy');
const { buildCommandDefinitions, hiddenCommandAliases } = require('../commands/definitions');
const { createAnnouncementCommands } = require('../commands/admin/announcementCommands');
const { createAuditCommands } = require('../commands/admin/auditCommands');
const { createBackupCommands } = require('../commands/admin/backupCommands');
const { createDayOffMutationCommands } = require('../commands/admin/dayOffMutationCommands');
const { createDayOffReadCommands } = require('../commands/admin/dayOffReadCommands');
const { createDiagnosticsCommand } = require('../commands/admin/diagnosticsCommand');
const { createForceAttendanceCommands } = require('../commands/admin/forceAttendanceCommands');
const { createOpsCheckCommand } = require('../commands/admin/opsCheckCommand');
const { createOpsQueueCommands, retryQueuedItem } = require('../commands/admin/opsQueueCommands');
const { createOpsSafetyCommands } = require('../commands/admin/opsSafetyCommands');
const { createPayrollAuditCommand } = require('../commands/admin/payrollAuditCommand');
const { createPayrollArchiveCommand } = require('../commands/admin/payrollArchiveCommand');
const { createMaintenanceCommands } = require('../commands/admin/maintenanceCommands');
const { createUserAdminCommands } = require('../commands/admin/userAdminCommands');
const { createMyInfoCommand } = require('../commands/user/myInfoCommand');
const {
    createAutoDelete,
    patchCommandReplies,
    createCommandOptionHelpers
} = require('../utils/interactionHelpers');
const { createChatInputCommandContext } = require('../events/chatInputCommandContext');
const { createChatInputCommandHandler } = require('../events/chatInputCommandHandler');
const { createButtonInteractionContext } = require('../events/buttonInteractionContext');
const { createButtonActionHandlers } = require('../events/buttonActionHandlers');
const { createButtonInteractionHandler } = require('../events/buttonInteractionHandler');
const {
    CUSTOM_IDS: DAY_OFF_REQUEST_CUSTOM_IDS,
    createDayOffRequestInteractionHandler
} = require('../events/dayOffRequestInteractionHandler');
const { createInteractionErrorHandler } = require('../events/interactionErrorHandler');
const { createVoiceStateUpdateHandler } = require('../events/voiceStateUpdateHandler');
const { createGuildMemberEventHandlers } = require('../events/guildMemberEventHandlers');
const {
    okText,
    failText,
    pendingText,
    withCommandStatusPayload
} = require('../utils/commandStatus');
const { createInteractionRouter } = require('../events/interactionRouter');
const { createDayOffMessageEventHandlers } = require('../events/dayOffMessageEventHandlers');
const { createPurchaseReactionHandler } = require('../events/purchaseReactionHandler');
const { createDeathPenaltyReactionHandler } = require('../events/deathPenaltyReactionHandler');
const { createEndAdenaReactionHandler } = require('../events/endAdenaReactionHandler');
const { createClientReadyHandler } = require('../events/clientReadyHandler');
const createPermissionUtils = require('../utils/permissions');
const {
    validateCommandPayloads,
    formatDiscordRestError
} = require('../utils/commandValidation');
const {
    createInteractionReplyErrorHandler,
    registerDiscordErrorGuards
} = require('../utils/discordErrorGuards');
const {
    padWidth,
    truncateWidth,
    formatDuration,
    formatExactWidth
} = require('../utils/textFormat');
const { createDashboardRenderHelpers } = require('../utils/dashboardRenderHelpers');
const {
    STATUS: RAW_ATTENDANCE_STATUS,
    mapClockInStatus: mapRawClockInStatus,
    mapClockOutStatus: mapRawClockOutStatus
} = require('../utils/rawAttendanceRules');
const { createSystemStateBridge } = require('../runtime/systemStateBridge');
const { createPersistenceRuntime } = require('../runtime/persistenceRuntime');
const { createStartupRuntime } = require('../runtime/startupRuntime');
const { createWorkflowRuntime } = require('../runtime/workflowRuntime');

module.exports = {
    fs,
    fsSync,
    path,
    crypto,
    moment,
    cron,
    google,
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    Events,
    REST,
    Routes,
    MessageFlags,
    PermissionFlagsBits,
    Partials,
    CONFIG,
    SHIFT_SCHEDULE,
    MAINTENANCE_WINDOWS,
    createDashboardStateUtils,
    dataStore,
    createAttendanceService,
    createRoleService,
    createDayOffService,
    createAdminService,
    createReportRenderer,
    createDashboardMessageService,
    createRuntimeHealthService,
    createPurchaseSheetService,
    createPayrollLiveSummarySyncService,
    createOpsQueueService,
    createPayrollOperationLogService,
    createPayrollArchiveService,
    createRawAttendanceSheetService,
    createMaintenanceOverrideService,
    collectStatusTransitionWarnings,
    buildCommandDefinitions,
    hiddenCommandAliases,
    createAnnouncementCommands,
    createAuditCommands,
    createBackupCommands,
    createDayOffMutationCommands,
    createDayOffReadCommands,
    createDiagnosticsCommand,
    createForceAttendanceCommands,
    createOpsCheckCommand,
    createOpsQueueCommands,
    retryQueuedItem,
    createOpsSafetyCommands,
    createPayrollAuditCommand,
    createPayrollArchiveCommand,
    createMaintenanceCommands,
    createUserAdminCommands,
    createMyInfoCommand,
    createAutoDelete,
    patchCommandReplies,
    createCommandOptionHelpers,
    createChatInputCommandContext,
    createChatInputCommandHandler,
    createButtonInteractionContext,
    createButtonActionHandlers,
    createButtonInteractionHandler,
    DAY_OFF_REQUEST_CUSTOM_IDS,
    createDayOffRequestInteractionHandler,
    createInteractionErrorHandler,
    createVoiceStateUpdateHandler,
    createGuildMemberEventHandlers,
    okText,
    failText,
    pendingText,
    withCommandStatusPayload,
    createInteractionRouter,
    createDayOffMessageEventHandlers,
    createPurchaseReactionHandler,
    createDeathPenaltyReactionHandler,
    createEndAdenaReactionHandler,
    createClientReadyHandler,
    createPermissionUtils,
    validateCommandPayloads,
    formatDiscordRestError,
    createInteractionReplyErrorHandler,
    registerDiscordErrorGuards,
    padWidth,
    truncateWidth,
    formatDuration,
    formatExactWidth,
    createDashboardRenderHelpers,
    RAW_ATTENDANCE_STATUS,
    mapRawClockInStatus,
    mapRawClockOutStatus,
    createSystemStateBridge,
    createPersistenceRuntime,
    createStartupRuntime,
    createWorkflowRuntime
};
