import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { CompanyRole, CreditLedgerEntryType, UserRole } from "@prisma/client";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { CompanyRoleGuard } from "../../common/guards/company-role.guard";
import { AdminGuard } from "../../common/guards/admin.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CompanyRoles } from "../../common/decorators/company-roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { PrismaService } from "../../common/prisma/prisma.service";
import { CreditLedgerService, serializeCreditEntry } from "./credit-ledger.service";

export class CreditTransactionsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ enum: CreditLedgerEntryType })
  @IsOptional()
  @IsEnum(CreditLedgerEntryType)
  type?: CreditLedgerEntryType;
}

/** Entry types an admin may record by hand; fee deductions are automatic. */
const ADMIN_ENTRY_TYPES = [
  CreditLedgerEntryType.PURCHASE,
  CreditLedgerEntryType.GRANT,
  CreditLedgerEntryType.REVERSAL,
  CreditLedgerEntryType.ADJUSTMENT,
] as const;

export class CreateCreditEntryDto {
  @ApiProperty({ enum: ADMIN_ENTRY_TYPES })
  @IsIn(ADMIN_ENTRY_TYPES)
  type: (typeof ADMIN_ENTRY_TYPES)[number];

  @ApiProperty({
    example: "5000000",
    description:
      "Signed integer amount in minor units. Positive adds credit; negative (REVERSAL/ADJUSTMENT only) removes it.",
  })
  @IsString()
  @Matches(/^-?[1-9]\d{0,18}$/, { message: "amount must be a non-zero integer string" })
  amount: string;

  @ApiProperty({ maxLength: 500, description: "Why the entry is being recorded (kept in the audit trail)" })
  @IsString()
  @MaxLength(500)
  description: string;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reference?: string;

  @ApiPropertyOptional({ maxLength: 128, description: "Retry-safe key; the same key never applies twice" })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

@ApiTags("companies")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyRoleGuard)
@Roles(UserRole.COMPANY)
@CompanyRoles(CompanyRole.OWNER, CompanyRole.BILLING)
@Controller("companies/me/credits")
export class CreditLedgerController {
  constructor(private readonly credits: CreditLedgerService) {}

  @Get("balance")
  @ApiOperation({ summary: "Current prepaid credit balance (OWNER and BILLING roles)" })
  async getBalance(@CurrentUser("id") companyId: string) {
    const balance = await this.credits.getBalance(companyId);
    return { companyId, balance: balance.toString() };
  }

  @Get("transactions")
  @ApiOperation({ summary: "Prepaid credit ledger history, newest first (OWNER and BILLING roles)" })
  listTransactions(
    @CurrentUser("id") companyId: string,
    @Query() query: CreditTransactionsQueryDto,
  ) {
    return this.credits.listEntries(companyId, query.page, query.limit, query.type);
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin/companies/:companyId/credits")
export class AdminCreditLedgerController {
  constructor(
    private readonly credits: CreditLedgerService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: "A company's credit balance and ledger history (admin only)" })
  async get(
    @Param("companyId") companyId: string,
    @Query() query: CreditTransactionsQueryDto,
  ) {
    await this.requireCompany(companyId);
    const [balance, history] = await Promise.all([
      this.credits.getBalance(companyId),
      this.credits.listEntries(companyId, query.page, query.limit, query.type),
    ]);
    return { companyId, balance: balance.toString(), ...history };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Record a credit purchase, grant, reversal or adjustment (admin only)" })
  async create(
    @Param("companyId") companyId: string,
    @Body() dto: CreateCreditEntryDto,
    @CurrentUser("id") adminId: string,
  ) {
    await this.requireCompany(companyId);
    const amount = BigInt(dto.amount);
    const negativeAllowed =
      dto.type === CreditLedgerEntryType.REVERSAL ||
      dto.type === CreditLedgerEntryType.ADJUSTMENT;
    if (amount < 0n && !negativeAllowed) {
      throw new BadRequestException("Negative amounts are only allowed for REVERSAL or ADJUSTMENT entries");
    }

    const entry = await this.credits.append(companyId, {
      type: dto.type,
      amount,
      description: dto.description,
      reference: dto.reference,
      idempotencyKey: dto.idempotencyKey,
      createdById: adminId,
    });
    return serializeCreditEntry(entry);
  }

  private async requireCompany(companyId: string) {
    const company = await this.prisma.user.findUnique({
      where: { id: companyId },
      select: { role: true },
    });
    if (!company || company.role !== UserRole.COMPANY) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }
  }
}
