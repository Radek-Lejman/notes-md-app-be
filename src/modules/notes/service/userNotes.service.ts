import { Injectable } from '@nestjs/common';
import { NotesService } from './notes.service';
import { Note, NoteBase } from '../interfaces/notes.interface';
import { GetNoteQueryDto } from '../dto/getNoteQuery.dto';
import { SearchNotesQueryDto } from '../dto/searchNotesQueryDto';
import { NotesTreeService } from './notesTree.service';
import { NotesSearchService } from './notesSerach.service';

@Injectable()
export class UserNotesService {
  constructor(
    private readonly notesService: NotesService,
    private readonly notesTreeService: NotesTreeService,
    private readonly notesSearchService: NotesSearchService,
  ) {}

  updateNoteById(id: string, note: NoteBase) {
    return this.notesService.updateNote(note, id);
  }

  public createNote(note: NoteBase, userId: string): Promise<Note | null> {
    return this.notesService.createNote(note, userId);
  }
  public getAllNotes(userId: string): Promise<Note[] | null> {
    return this.notesService.getAllNotes(userId);
  }

  public async getNoteById(id: string, query: GetNoteQueryDto): Promise<any | null> {
    const note = await this.notesTreeService.getNoteWithFamily(id, query);

    return note;
  }

  async searchByText(sub: string, query: SearchNotesQueryDto): Promise<Note[]> {
    const note = await this.notesSearchService.searchByText(sub, query);
    return note;
  }
}
