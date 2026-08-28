import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SERVER_PATH } from '../constants/api.constants';
import { UrlResolverService } from '../services/url-resolver.service';
import {
  ActivityEntry,
  ServerActivityDto,
  fromServerActivityDto,
  toServerActivityRequest,
} from '../models/activity.model';

@Injectable({ providedIn: 'root' })
export class ServerActivityGateway {
  private readonly http = inject(HttpClient);
  private readonly urlResolver = inject(UrlResolverService);

  list(): Observable<ActivityEntry[]> {
    const url = `${this.urlResolver.serverUrl()}${SERVER_PATH.ACTIVITY}`;
    return this.http
      .get<ServerActivityDto[]>(url)
      .pipe(map((dtos) => dtos.map(fromServerActivityDto)));
  }

  append(entry: ActivityEntry): Observable<void> {
    const url = `${this.urlResolver.serverUrl()}${SERVER_PATH.ACTIVITY}`;
    return this.http.post<void>(url, toServerActivityRequest(entry));
  }
}
