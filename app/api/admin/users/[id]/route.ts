import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const ADMIN_EMAIL = "thoeni@gmail.com";

// PATCH - Block/Unblock a user
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session || session.user?.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { blocked, reason } = body;

    if (typeof blocked !== "boolean") {
      return NextResponse.json({ error: "blocked field is required" }, { status: 400 });
    }

    // Prevent admin from blocking themselves
    const userToBlock = await prisma.user.findUnique({
      where: { id },
      select: { email: true },
    });

    if (userToBlock?.email === ADMIN_EMAIL) {
      return NextResponse.json({ error: "Cannot block admin user" }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        blocked,
        blockedAt: blocked ? new Date() : null,
        blockedReason: blocked ? (reason || "Blocked by admin") : null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        blocked: true,
        blockedAt: true,
        blockedReason: true,
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

// DELETE - Delete a user and their data
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session || session.user?.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { id } = await params;

    // Prevent admin from deleting themselves
    const userToDelete = await prisma.user.findUnique({
      where: { id },
      select: { email: true },
    });

    if (userToDelete?.email === ADMIN_EMAIL) {
      return NextResponse.json({ error: "Cannot delete admin user" }, { status: 400 });
    }

    // Delete user (cascades to recipes, accounts, sessions)
    await prisma.user.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}

