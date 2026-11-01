import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Patch,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserNotesService } from '../service/userNotes.service';
import { Note, NoteSearchResult, NoteSummary, NoteWithFamily } from '../interfaces/notes.interface';
import { CreateNoteDto, UpdateNoteDto } from '../dto/note.dto';
import { GetNoteQueryDto } from '../dto/getNoteQuery.dto';
import { AuthUser } from '@common';
import { validateAndNormalizeFields } from '../utils/validateNoteFields';
import { CurrentUser } from '@common/decorators';
import { SearchNotesQueryDto } from '../dto/searchNotesQueryDto';
import { ImportNotesDto, ImportResult } from '../dto/importNotes.dto';
import { NotesImportService } from '../service/notesImport.service';
import { IMPORT_THROTTLE } from '../consts/import.consts';

@Controller('/notes')
export class NotesController {
  private readonly logger = new Logger(NotesController.name);
  constructor(
    private readonly notesService: UserNotesService,
    private readonly notesImportService: NotesImportService,
  ) {}

  @Get('')
  async getAll(@CurrentUser() user: AuthUser): Promise<NoteSummary[] | null> {
    const userNotes = await this.notesService.getAllNotes(user.sub);
    this.logger.log(userNotes);

    return userNotes;
  }

  @HttpCode(HttpStatus.OK)
  @Post('')
  async createNote(@Body() noteDto: CreateNoteDto, @CurrentUser() user: AuthUser) {
    return await this.notesService.createNote(noteDto, user.sub);
  }

  /** Many markdown files as one note tree; `dryRun` only reports. Larger body limit: configureApp. */
  @HttpCode(HttpStatus.OK)
  @Throttle(IMPORT_THROTTLE)
  @Post('import')
  async importNotes(
    @Body() importDto: ImportNotesDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ImportResult> {
    return await this.notesImportService.importNotes(importDto, user.sub);
  }

  @Get('search')
  async search(
    @CurrentUser() user: AuthUser,
    @Query() query: SearchNotesQueryDto,
  ): Promise<NoteSearchResult[]> {
    [query.fields, query['children.fields']].forEach((f) => validateAndNormalizeFields(f));
    if (!query.q?.trim()) {
      throw new BadRequestException('Query "q" is required');
    }

    return await this.notesService.searchByText(user.sub, query);
  }

  @Get(':id')
  async getNoteById(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query() query: GetNoteQueryDto,
  ): Promise<NoteWithFamily | null> {
    [query.fields, query['children.fields']].forEach((fields) =>
      validateAndNormalizeFields(fields),
    );
    const noteWithChildren = await this.notesService.getNoteById(id, query, user.sub);

    if (!noteWithChildren) {
      throw new NotFoundException(`Note ${id} not found`);
    }

    return noteWithChildren;
  }

  @Patch(':id')
  async updateNoteById(
    @Param('id') id: string,
    @Body() updateDto: UpdateNoteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Note | null> {
    return await this.notesService.updateNoteById(id, updateDto, user.sub);
  }
}
