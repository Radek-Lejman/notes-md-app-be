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
  Put,
  Query,
} from '@nestjs/common';
import { UserNotesService } from '../service/userNotes.service';
import { Note, NoteWithFamily } from '../interfaces/notes.interface';
import { CreateNoteDto } from '../dto/note.dto';
import { GetNoteQueryDto } from '../dto/getNoteQuery.dto';
import { AuthUser } from '@security';
import { validateAndNormalizeFields } from '../utils/validateNoteFields';
import { CurrentUser } from '@common/decorators';
import { SearchNotesQueryDto } from '../dto/searchNotesQueryDto';

@Controller('/notes')
export class NotesController {
  private readonly logger = new Logger(NotesController.name);
  constructor(private readonly notesService: UserNotesService) {}

  @Get('')
  async getAll(@CurrentUser() user: AuthUser): Promise<Note[] | null> {
    const userNotes = await this.notesService.getAllNotes(user.sub);
    this.logger.log(userNotes);

    return userNotes;
  }

  @HttpCode(HttpStatus.OK)
  @Post('')
  async createNote(@Body() noteDto: CreateNoteDto, @CurrentUser() user: AuthUser) {
    const userNotes = await this.notesService.createNote(noteDto, user.sub);
    this.logger.log(userNotes);

    return { messsage: 'Note created' };
  }

  @Get('search')
  async search(
    @CurrentUser() user: AuthUser,
    @Query() query: SearchNotesQueryDto,
  ): Promise<Note[]> {
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

  @Put(':id')
  async updateNoteById(
    @Param('id') id: string,
    @Body() updateDto: CreateNoteDto,
  ): Promise<Note | null> {
    const noteWithChildren = await this.notesService.updateNoteById(id, updateDto);

    return noteWithChildren;
  }
}
