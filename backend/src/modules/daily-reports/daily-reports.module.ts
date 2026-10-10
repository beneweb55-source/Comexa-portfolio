import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DailyReportsController } from './daily-reports.controller.js';
import { DailyReportsService } from './daily-reports.service.js';

/** Récapitulatifs journaliers de l'équipe. */
@Module({
  imports: [AuthModule],
  controllers: [DailyReportsController],
  providers: [DailyReportsService],
})
export class DailyReportsModule {}
