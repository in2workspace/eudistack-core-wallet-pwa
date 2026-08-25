/**
 * A set of origins that are front-door aliases (canonical + vanity domains,
 * e.g. CloudFront distributions) for the same physical wallet backend/DB.
 * Populated only for confirmed shared-backend aliases — see
 * `tenants/instance-groups.json` in eudistack-platform-assets.
 */
export interface InstanceGroup {
  id: string;
  brokerUrl: string;
  memberOrigins: string[];
}

export interface InstanceGroupsConfig {
  groups: InstanceGroup[];
}
