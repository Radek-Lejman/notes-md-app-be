import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { JwtModule } from '@nestjs/jwt';
import { SecurityModule } from 'src/infrastructure/security/security.module';
import { NotesController } from './controller/notes.controller';
import { UserNotesService } from './service/userNotes.service';
import { NotesService } from './service/notes.service';
import { SearchNotesService } from './service/searchNote.service';

@Module({
  controllers: [NotesController],
  imports: [UsersModule, SecurityModule, JwtModule.register({ global: true })],
  providers: [UserNotesService, NotesService, SearchNotesService],
  exports: [UserNotesService],
})
export class NotesModule {}
