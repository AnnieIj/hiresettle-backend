import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
  ApiBody,
} from "@nestjs/swagger";
import { Response } from "express";
import { IsEnum, IsString, IsNotEmpty, IsOptional, Matches, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { BillingService } from "./billing.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { CompanyRoleGuard } from "../../common/guards/company-role.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CompanyRoles } from "../../common/decorators/company-roles.decorator";
import { UserRole, CompanyRole } from "@prisma/client";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { PrismaService } from "../../common/prisma/prisma.service";

class AddCompanyMemberDto {
  @ApiProperty({ example: "user-uuid" })
  @IsString()
  @IsNotEmpty()
  memberId: string;

  @ApiProperty({ enum: CompanyRole, example: CompanyRole.MEMBER })
  @IsEnum(CompanyRole)
  companyRole: CompanyRole;
}

class UpdateTaxProfileDto {
  @ApiProperty({ example: "DE", description: "ISO 3166-1 alpha-2 country of establishment" })
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: "taxCountry must be a 2-letter ISO country code" })
  taxCountry: string;

  @ApiPropertyOptional({
    example: "DE123456789",
    description: "VAT / tax registration number. EU numbers must include the country prefix. Send null to clear.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  taxId?: string | null;
}

@ApiTags("companies")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.COMPANY)
@Controller("companies/me")
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("billing")
  @UseGuards(CompanyRoleGuard)
  @CompanyRoles(CompanyRole.OWNER, CompanyRole.BILLING)
  @ApiOperation({
    summary: "Get company billing summary (OWNER and BILLING roles)",
  })
  @ApiQuery({
    name: "from",
    required: false,
    description: "Start date (ISO format)",
  })
  @ApiQuery({
    name: "to",
    required: false,
    description: "End date (ISO format)",
  })
  @ApiQuery({
    name: "fiat",
    required: false,
    description: "3-letter ISO 4217 currency for fiat-equivalent totals (e.g. USD). Omit for token amounts only.",
  })
  getBillingSummary(
    @CurrentUser() user: any,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("fiat") fiat?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    return this.billingService.getBillingSummary(user, fromDate, toDate, parseFiat(fiat));
  }

  @Get("billing/export.csv")
  @UseGuards(CompanyRoleGuard)
  @CompanyRoles(CompanyRole.OWNER, CompanyRole.BILLING)
  @ApiOperation({
    summary: "Export billing data as CSV (OWNER and BILLING roles)",
  })
  @ApiQuery({
    name: "from",
    required: false,
    description: "Start date (ISO format)",
  })
  @ApiQuery({
    name: "to",
    required: false,
    description: "End date (ISO format)",
  })
  @ApiQuery({
    name: "fiat",
    required: false,
    description: "3-letter ISO 4217 currency to include fiat-equivalent columns (e.g. USD)",
  })
  async exportBillingCsv(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("fiat") fiat?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const csvContent = await this.billingService.exportBillingToCsv(
      user,
      fromDate,
      toDate,
      parseFiat(fiat),
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="billing-export.csv"',
    );
    res.status(HttpStatus.OK).send(csvContent);
  }

  @Get("billing/usage")
  @UseGuards(CompanyRoleGuard)
  @CompanyRoles(CompanyRole.OWNER, CompanyRole.BILLING)
  @ApiOperation({
    summary: "Get company API usage count for the trailing 24 hours",
  })
  getCompanyUsage(@CurrentUser("id") userId: string) {
    return this.billingService.getCompanyUsage(userId);
  }

  @Get("billing/invoices/:id.pdf")
  @UseGuards(CompanyRoleGuard)
  @CompanyRoles(CompanyRole.OWNER, CompanyRole.BILLING)
  @ApiOperation({
    summary: "Generate invoice PDF for a billing period, with VAT / reverse charge from the tax profile",
  })
  async getInvoicePdf(
    @CurrentUser() user: any,
    @Param("id") invoiceId: string,
    @Res() res: Response,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const invoice = await this.billingService.generateInvoicePdf(
      user,
      invoiceId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="invoice-${invoiceId}.pdf"`,
    );
    res.status(HttpStatus.OK).send(invoice);
  }

  @Get("tax-profile")
  @UseGuards(CompanyRoleGuard)
  @CompanyRoles(CompanyRole.OWNER, CompanyRole.BILLING)
  @ApiOperation({ summary: "Get the company's tax country and VAT ID (OWNER and BILLING roles)" })
  getTaxProfile(@CurrentUser("id") companyId: string) {
    return this.billingService.getTaxProfile(companyId);
  }

  @Put("tax-profile")
  @UseGuards(CompanyRoleGuard)
  @CompanyRoles(CompanyRole.OWNER, CompanyRole.BILLING)
  @ApiOperation({
    summary: "Set the company's tax country and VAT ID used for invoice VAT (OWNER and BILLING roles)",
  })
  @ApiBody({ type: UpdateTaxProfileDto })
  updateTaxProfile(
    @CurrentUser("id") companyId: string,
    @Body() dto: UpdateTaxProfileDto,
  ) {
    return this.billingService.updateTaxProfile(companyId, dto);
  }

  /**
   * GET /api/v1/companies/me/members
   * List team members for the current company (OWNER only).
   */
  @Get("members")
  @UseGuards(CompanyRoleGuard)
  @CompanyRoles(CompanyRole.OWNER)
  @ApiOperation({ summary: "List company team members (OWNER only)" })
  async listMembers(@CurrentUser("id") companyId: string) {
    return this.prisma.companyMember.findMany({
      where: { companyId },
      include: {
        member: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * POST /api/v1/companies/me/members
   * Add a team member to the company (OWNER only).
   */
  @Post("members")
  @UseGuards(CompanyRoleGuard)
  @CompanyRoles(CompanyRole.OWNER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Add a team member to the company (OWNER only)" })
  @ApiBody({ type: AddCompanyMemberDto })
  async addMember(
    @CurrentUser("id") companyId: string,
    @Body() dto: AddCompanyMemberDto,
  ) {
    if (dto.memberId === companyId) {
      throw new BadRequestException("Cannot add yourself as a member");
    }
    const existing = await this.prisma.companyMember.findUnique({
      where: { companyId_memberId: { companyId, memberId: dto.memberId } },
    });
    if (existing) {
      throw new BadRequestException("User is already a member of this company");
    }
    return this.prisma.companyMember.create({
      data: { companyId, memberId: dto.memberId, companyRole: dto.companyRole },
      include: { member: { select: { id: true, name: true, email: true } } },
    });
  }

  /**
   * DELETE /api/v1/companies/me/members/:memberId
   * Remove a team member from the company (OWNER only).
   */
  @Delete("members/:memberId")
  @UseGuards(CompanyRoleGuard)
  @CompanyRoles(CompanyRole.OWNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Remove a team member from the company (OWNER only)",
  })
  @ApiParam({
    name: "memberId",
    description: "User ID of the member to remove",
  })
  async removeMember(
    @CurrentUser("id") companyId: string,
    @Param("memberId") memberId: string,
  ) {
    const existing = await this.prisma.companyMember.findUnique({
      where: { companyId_memberId: { companyId, memberId } },
    });
    if (!existing) {
      throw new BadRequestException("User is not a member of this company");
    }
    await this.prisma.companyMember.delete({
      where: { companyId_memberId: { companyId, memberId } },
    });
    return { message: "Member removed from company" };
  }
}

@ApiTags("billing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.COMPANY, UserRole.ADMIN)
@Controller("billing")
export class BillingExportController {
  constructor(private readonly billingService: BillingService) {}

  @Get("export")
  @ApiOperation({
    summary:
      "Export billing history as CSV (COMPANY sees own records; ADMIN sees all)",
  })
  @ApiQuery({
    name: "from",
    required: false,
    description: "Start date (ISO format)",
  })
  @ApiQuery({
    name: "to",
    required: false,
    description: "End date (ISO format)",
  })
  async exportCsv(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const csv = await this.billingService.exportBillingHistory(
      user,
      fromDate,
      toDate,
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="billing-history-${Date.now()}.csv"`,
    );
    res.status(HttpStatus.OK).send(csv);
  }

  @Get("usage")
  @ApiOperation({
    summary:
      "Query request usage for the current company within the rolling window",
  })
  getUsage(@CurrentUser("companyId") companyId: string) {
    return this.billingService.getCompanyUsage(companyId || "unknown");
  }
}

/** Validate and normalize an optional fiat currency query param. */
function parseFiat(fiat?: string): string | undefined {
  if (!fiat) return undefined;
  const normalized = fiat.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new BadRequestException(
      "fiat must be a 3-letter ISO 4217 currency code (e.g. USD)",
    );
  }
  return normalized;
}
