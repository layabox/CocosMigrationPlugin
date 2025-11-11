const InternalUuidMap: Record<string, string> = {
    "1263d74c-8167-4928-91a6-4e2672411f47@a804a": "6e013e32-fec7-4397-80d1-f918a07607be",
    "620b6bf3-0369-4560-837f-2a2c00b73c26":"6f90bbb0-bcb2-4311-8a9d-3d8277522098",
};
export function formatUuid(uuid: string): string {
    return InternalUuidMap[uuid] || uuid;
}