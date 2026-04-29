"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Search,
  Shield,
  Ban,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Lock,
  Unlock,
} from "lucide-react";

type UserRole = "admin" | "landlord" | "tenant" | "agent";
type UserStatus = "active" | "suspended" | "pending";

interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  joinedDate: string;
  lastActive: string;
}

interface RoleChangeDialogState {
  isOpen: boolean;
  userId?: string;
  userName?: string;
  currentRole?: UserRole;
}

interface SuspensionDialogState {
  isOpen: boolean;
  userId?: string;
  userName?: string;
  reason: string;
}

const mockUsers: User[] = [
  {
    id: "u1",
    name: "Alice Johnson",
    email: "alice@example.com",
    role: "tenant",
    status: "active",
    joinedDate: "2024-01-15",
    lastActive: "2024-04-28",
  },
  {
    id: "u2",
    name: "Bob Smith",
    email: "bob@example.com",
    role: "landlord",
    status: "active",
    joinedDate: "2023-12-20",
    lastActive: "2024-04-27",
  },
  {
    id: "u3",
    name: "Carol White",
    email: "carol@example.com",
    role: "agent",
    status: "active",
    joinedDate: "2024-02-10",
    lastActive: "2024-04-28",
  },
  {
    id: "u4",
    name: "David Brown",
    email: "david@example.com",
    role: "tenant",
    status: "suspended",
    joinedDate: "2024-01-01",
    lastActive: "2024-04-20",
  },
  {
    id: "u5",
    name: "Eve Davis",
    email: "eve@example.com",
    role: "landlord",
    status: "active",
    joinedDate: "2024-03-05",
    lastActive: "2024-04-26",
  },
];

const ROLES: { value: UserRole; label: string }[] = [
  { value: "tenant", label: "Tenant" },
  { value: "landlord", label: "Landlord" },
  { value: "agent", label: "Agent" },
  { value: "admin", label: "Admin" },
];

const STATUSES: { value: UserStatus; label: string; icon: React.ElementType }[] =
  [
    { value: "active", label: "Active", icon: CheckCircle2 },
    { value: "pending", label: "Pending", icon: AlertCircle },
    { value: "suspended", label: "Suspended", icon: Lock },
  ];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>(mockUsers);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [roleChangeDialog, setRoleChangeDialog] = useState<RoleChangeDialogState>(
    { isOpen: false }
  );
  const [suspensionDialog, setSuspensionDialog] = useState<SuspensionDialogState>(
    { isOpen: false, reason: "" }
  );
  const [newRole, setNewRole] = useState<UserRole>("tenant");

  const ITEMS_PER_PAGE = 5;

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch =
        user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesStatus =
        statusFilter === "all" || user.status === statusFilter;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredUsers.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredUsers, currentPage]);

  const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);

  const handleRoleChange = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (user) {
      setRoleChangeDialog({
        isOpen: true,
        userId,
        userName: user.name,
        currentRole: user.role,
      });
      setNewRole(user.role);
    }
  };

  const confirmRoleChange = () => {
    if (roleChangeDialog.userId) {
      setUsers(
        users.map((u) =>
          u.id === roleChangeDialog.userId ? { ...u, role: newRole } : u
        )
      );
    }
    setRoleChangeDialog({ isOpen: false });
  };

  const handleSuspension = (userId: string, suspend: boolean) => {
    const user = users.find((u) => u.id === userId);
    if (user) {
      if (suspend) {
        setSuspensionDialog({
          isOpen: true,
          userId,
          userName: user.name,
          reason: "",
        });
      } else {
        setUsers(
          users.map((u) =>
            u.id === userId ? { ...u, status: "active" } : u
          )
        );
      }
    }
  };

  const confirmSuspension = () => {
    if (suspensionDialog.userId) {
      setUsers(
        users.map((u) =>
          u.id === suspensionDialog.userId
            ? { ...u, status: "suspended" }
            : u
        )
      );
    }
    setSuspensionDialog({ isOpen: false, reason: "" });
  };

  const stats = {
    total: users.length,
    active: users.filter((u) => u.status === "active").length,
    suspended: users.filter((u) => u.status === "suspended").length,
  };

  return (
    <main className="min-h-screen bg-background py-12">
      <div className="container mx-auto px-4">
        <div className="mb-8">
          <h1 className="font-mono text-4xl font-black mb-2">User Management</h1>
          <p className="text-muted-foreground">
            Manage user accounts, roles, and permissions
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Total Users", value: stats.total, color: "bg-primary" },
            {
              label: "Active Users",
              value: stats.active,
              color: "bg-green-500",
            },
            {
              label: "Suspended",
              value: stats.suspended,
              color: "bg-red-500",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="border-3 border-foreground bg-card p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <p className="text-xs text-muted-foreground font-mono">
                {stat.label}
              </p>
              <p className={`text-3xl font-black mt-1 ${stat.color}`}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Search and Filters */}
        <div className="border-3 border-foreground bg-card p-4 mb-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:gap-3">
            <div className="flex-1 max-w-md">
              <Label className="text-sm font-bold mb-1">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search by name or email..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="border-2 border-foreground pl-9"
                />
              </div>
            </div>

            <div className="max-w-xs">
              <Label className="text-sm font-bold mb-1">Role</Label>
              <Select value={roleFilter} onValueChange={(value: any) => setRoleFilter(value)}>
                <SelectTrigger className="border-2 border-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  {ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="max-w-xs">
              <Label className="text-sm font-bold mb-1">Status</Label>
              <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
                <SelectTrigger className="border-2 border-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {STATUSES.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div className="border-3 border-foreground bg-card shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b-3 border-foreground bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left font-mono text-sm font-bold">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left font-mono text-sm font-bold">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left font-mono text-sm font-bold">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left font-mono text-sm font-bold">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left font-mono text-sm font-bold">
                    Joined
                  </th>
                  <th className="px-4 py-3 text-right font-mono text-sm font-bold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedUsers.map((user) => {
                  const statusInfo = STATUSES.find((s) => s.value === user.status);
                  const StatusIcon = statusInfo?.icon;

                  return (
                    <tr
                      key={user.id}
                      className="border-b-2 border-foreground hover:bg-muted transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-sm font-bold">
                        {user.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {user.email}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 border-2 border-foreground px-2 py-1 text-xs font-bold bg-background">
                          <Shield className="h-3 w-3" />
                          {ROLES.find((r) => r.value === user.role)?.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {StatusIcon && (
                            <StatusIcon className="h-4 w-4" />
                          )}
                          <span className="text-sm font-mono">
                            {statusInfo?.label}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {new Date(user.joinedDate).toLocaleDateString("en-NG")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRoleChange(user.id)}
                            className="h-6 w-6 p-0"
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleSuspension(user.id, user.status !== "suspended")
                            }
                            className="h-6 w-6 p-0"
                          >
                            {user.status === "suspended" ? (
                              <Unlock className="h-3 w-3" />
                            ) : (
                              <Lock className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {paginatedUsers.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              No users found
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6">
            <p className="text-sm text-muted-foreground">
              Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to{" "}
              {Math.min(currentPage * ITEMS_PER_PAGE, filteredUsers.length)} of{" "}
              {filteredUsers.length} users
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="border-2 border-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage === totalPages}
                className="border-2 border-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Role Change Dialog */}
      <Dialog open={roleChangeDialog.isOpen} onOpenChange={(open) => setRoleChangeDialog({ ...roleChangeDialog, isOpen: open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change User Role</DialogTitle>
            <DialogDescription>
              Change the role for {roleChangeDialog.userName}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-sm font-bold mb-2">New Role</Label>
              <Select value={newRole} onValueChange={(value: any) => setNewRole(value)}>
                <SelectTrigger className="border-2 border-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setRoleChangeDialog({ isOpen: false })}
              className="border-2 border-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmRoleChange}
              className="border-3 border-foreground bg-primary font-bold"
            >
              Confirm Change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspension Dialog */}
      <Dialog open={suspensionDialog.isOpen} onOpenChange={(open) => setSuspensionDialog({ ...suspensionDialog, isOpen: open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend Account</DialogTitle>
            <DialogDescription>
              Suspend account for {suspensionDialog.userName}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="reason" className="text-sm font-bold mb-2">
                Reason for Suspension
              </Label>
              <Textarea
                id="reason"
                placeholder="Provide a reason for suspending this account..."
                value={suspensionDialog.reason}
                onChange={(e) =>
                  setSuspensionDialog({ ...suspensionDialog, reason: e.target.value })
                }
                className="border-2 border-foreground"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setSuspensionDialog({ isOpen: false, reason: "" })}
              className="border-2 border-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmSuspension}
              className="border-3 border-foreground bg-destructive font-bold text-white"
            >
              Suspend Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
