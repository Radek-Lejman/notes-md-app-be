import { Injectable } from '@nestjs/common';
import { NotesService } from './notes.service';
import { Note, NoteBase } from '../interfaces/notes.interface';
import { GetNoteQueryDto } from '../dto/get-note.query.dto';
import { SearchNotesService } from './searchNote.service';

@Injectable()
export class UserNotesService {
  constructor(
    private readonly notesService: NotesService,
    private readonly searchNotesService: SearchNotesService,
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
    const note = await this.searchNotesService.searchById(id, query);

    return note;
  }
}
