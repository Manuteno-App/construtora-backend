import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('mcp_audit_logs')
export class McpAuditLog {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', nullable: true }) userId?: string;
  @Column({ name: 'tool_name' }) toolName!: string;
  @Column({ type: 'jsonb' }) arguments!: Record<string, unknown>;
  @Column({ nullable: true }) success?: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
