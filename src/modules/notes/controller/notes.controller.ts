import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { UserNotesService } from '../service/userNotes.service';
import { Note, NoteWithFamily } from '../interfaces/notes.interface';
import { CreateNoteDto } from '../dto/note.dto';
import { GetNoteQueryDto } from '../dto/get-note.query.dto';
import { AuthUser, CurrentUser } from '@security';

@Controller('/notes')
export class NotesController {
  private readonly logger = new Logger(NotesController.name);
  constructor(private readonly notesService: UserNotesService) {}

  @Get('')
  async getAll(@CurrentUser() user: AuthUser): Promise<Note[] | null> {
    const tokenUserData = user;

    const userNotes = await this.notesService.getAllNotes(tokenUserData.sub);
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

  @Get(':id')
  async getNoteById(
    @Param('id') id: string,
    @Query() query: GetNoteQueryDto,
  ): Promise<NoteWithFamily | null> {
    const noteWithChildren = await this.notesService.getNoteById(id, query);

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
