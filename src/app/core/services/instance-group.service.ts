import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { InstanceGroup, InstanceGroupsConfig } from '../models/instance-group.model';

const INSTANCE_GROUPS_CONFIG_URL = '/assets/tenants/instance-groups.json';
const EMPTY_CONFIG: InstanceGroupsConfig = { groups: [] };

/**
 * Resolves whether the current origin is a member of a cross-origin instance
 * group (front-door aliases sharing the same wallet backend/DB — see
 * `InstanceGroup`). Consumed by `SingleInstanceService` to decide whether the
 * single-instance guard needs the cross-origin broker relay or can use the
 * plain same-origin `BroadcastChannel` as before.
 */
@Injectable({ providedIn: 'root' })
export class InstanceGroupService {
  private readonly http = inject(HttpClient);
  private configPromise: Promise<InstanceGroupsConfig> | null = null;

  public async resolveGroupForOrigin(origin: string = window.location.origin): Promise<InstanceGroup | null> {
    const config = await this.loadConfig();
    return config.groups.find(group => group.memberOrigins.includes(origin)) ?? null;
  }

  private loadConfig(): Promise<InstanceGroupsConfig> {
    this.configPromise ??= firstValueFrom(
      this.http.get<InstanceGroupsConfig>(INSTANCE_GROUPS_CONFIG_URL),
    ).catch(() => EMPTY_CONFIG);
    return this.configPromise;
  }
}
