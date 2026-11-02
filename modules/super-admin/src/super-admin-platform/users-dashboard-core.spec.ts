import { usersRoleDistribution } from './super-admin-platform.repository';

// Standalone harness spec (esbuild → node). Validates the pure role-distribution helper behind the Users & Roles
// dashboard donut: four fixed slices, "Other" as the non-negative remainder, robust to missing fields.
let pass = 0, fail = 0;
function check(name: string, cond: boolean) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

const d = usersRoleDistribution({ totalUsers: 156, admins: 7, managers: 32, staff: 110 });
check('returns four slices', d.length === 4);
check('labels are Admin/Manager/Staff/Other', d.map((x) => x.label).join(',') === 'Admin,Manager,Staff,Other');
check('admin/manager/staff pass through', d[0].count === 7 && d[1].count === 32 && d[2].count === 110);
check('other = remainder (156-7-32-110=7)', d[3].count === 7);

const sum = usersRoleDistribution({ totalUsers: 156, admins: 7, managers: 32, staff: 110 }).reduce((s, x) => s + x.count, 0);
check('slices sum to total', sum === 156);

check('other never negative when groups exceed total', usersRoleDistribution({ totalUsers: 5, admins: 7, managers: 32, staff: 110 })[3].count === 0);
check('handles all zero', usersRoleDistribution({ totalUsers: 0, admins: 0, managers: 0, staff: 0 }).every((x) => x.count === 0));
check('missing fields treated as 0', usersRoleDistribution({ totalUsers: 10 } as any)[3].count === 10);

console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
if (fail > 0) process.exit(1);
