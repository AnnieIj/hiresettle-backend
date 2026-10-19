import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { PortfolioService } from './portfolio.service';
import { CreatePortfolioEntryDto, UpdatePortfolioEntryDto } from './dto/portfolio-entry.dto';

@ApiTags('recruiters')
@Controller('recruiters/me/portfolio')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RECRUITER)
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get()
  @ApiOperation({ summary: 'List my portfolio entries' })
  @ApiResponse({ status: 200, description: 'Portfolio entries returned' })
  listEntries(@CurrentUser('id') recruiterId: string) {
    return this.portfolioService.listEntries(recruiterId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a portfolio entry' })
  @ApiResponse({ status: 201, description: 'Entry created' })
  createEntry(
    @CurrentUser('id') recruiterId: string,
    @Body() dto: CreatePortfolioEntryDto,
  ) {
    return this.portfolioService.createEntry(recruiterId, dto);
  }

  @Patch(':entryId')
  @ApiOperation({ summary: 'Update a portfolio entry' })
  @ApiParam({ name: 'entryId', description: 'Portfolio entry ID' })
  @ApiResponse({ status: 200, description: 'Entry updated' })
  @ApiResponse({ status: 403, description: 'Not your entry' })
  @ApiResponse({ status: 404, description: 'Entry not found' })
  updateEntry(
    @CurrentUser('id') recruiterId: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdatePortfolioEntryDto,
  ) {
    return this.portfolioService.updateEntry(recruiterId, entryId, dto);
  }

  @Delete(':entryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a portfolio entry' })
  @ApiParam({ name: 'entryId', description: 'Portfolio entry ID' })
  @ApiResponse({ status: 204, description: 'Entry deleted' })
  @ApiResponse({ status: 403, description: 'Not your entry' })
  @ApiResponse({ status: 404, description: 'Entry not found' })
  deleteEntry(
    @CurrentUser('id') recruiterId: string,
    @Param('entryId') entryId: string,
  ) {
    return this.portfolioService.deleteEntry(recruiterId, entryId);
  }
}

// Public endpoint — no auth required
@ApiTags('recruiters')
@Controller('recruiters/:recruiterId/portfolio')
export class PublicPortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get()
  @ApiOperation({ summary: "List a recruiter's public portfolio entries" })
  @ApiParam({ name: 'recruiterId', description: 'Recruiter user ID' })
  @ApiResponse({ status: 200, description: 'Portfolio entries returned' })
  listPublicEntries(@Param('recruiterId') recruiterId: string) {
    return this.portfolioService.listEntries(recruiterId);
  }
}
