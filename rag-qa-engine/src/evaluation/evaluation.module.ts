import { Module } from '@nestjs/common';
import { EvaluationRunner } from './evaluation'; // or wherever your class is
import { MetricsService } from './metrics.service';
import { EvaluatorService } from './evaluator.service';

@Module({
  providers: [EvaluationRunner, MetricsService, EvaluatorService],
  exports: [EvaluationRunner], // Export it if you need it elsewhere
})
export class EvaluationModule {}