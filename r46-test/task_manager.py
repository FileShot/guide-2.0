#!/usr/bin/env python3
# -*- coding: utf-8 -*-
""
Production-Quality Task Management System
============================================
A robust, extensible task management framework supporting:
- Task entities with priority levels, due dates, tags, subtasks
- Multiple list operations (filtering, sorting, searching)
- Export functionality to JSON/CSV
- Undo/redo history for state recovery
- Statistics generation and reports
- Comprehensive error handling throughout
"""

import json
import csv
from datetime import datetime, date
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, field, asdict
from enum import Enum
from collections import defaultdict
from copy import deepcopy
import re


@dataclass
class PriorityLevel(Enum):
    """Task priority enumeration."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

    def __str__(self) -> str:
        return self.value.upper()


@dataclass
class Tag:
    """Tag representation with support for multiple values."""
    name: str
    color: str  # Hex color code
    description: Optional[str] = None

    @classmethod
    def from_string(cls, tag_name: str, color: str = "#FF0000") -> 'Tag':
        """Create a new tag instance."""
        if not tag_name or not tag_name.strip():
            raise ValueError("Tag name cannot be empty")
        return cls(name=tag_name.strip(), color=color.lower())

    def get_color(self) -> str:
        """Get hex color code for CSS styling."""
        if self.color.startswith('#'):
            return f"#{self.color}"
        elif len(self.color) == 7:
            return '#' + self.color[:2].upper() + self.color[1:].lower() * 6
        else:
            return '#0000AA'

    def matches_tag_filter(self, filter_value: str) -> bool:
        """Check if this tag's name contains the filter value."""
        if not self.name or not filter_value:
            return False
        return filter_value in self.name


@dataclass(order=True)
class Status(Enum):
    """Task status ordering for serialization purposes."""
    DRAFT = 0
    PENDING = 1
    IN_PROGRESS = 2
    REVIEWING = 3
    COMPLETED = 4
    CANCELLED = 5

    def sort_key(self) -> int:
        return self.value


@dataclass
class Task:
    """
    Represents a single task with full metadata.
    
    Attributes:
        id: Unique identifier (UUID format)
        title: Human-readable task title
        description: Detailed task description
        content: Raw text content of the task
        due_date: Date when task must be completed
        deadline: Hard deadline date/time
        priority: Priority level (LOW/MEDIUM/HIGH/CRITICAL)
        tags: List of associated tags
        subtasks: Nested list of child tasks
        parent_id: Reference to parent task ID (for hierarchical structure)
        user_ids: Set of users who own/manage this task
        created_at: Timestamp when task was created
        updated_at: Timestamp when last update occurred
        deleted_at: Timestamp if task was deleted
        is_deleted: Boolean flag indicating deletion state
        source_file: Optional reference to original file path
        source_line: Optional line number from source file
        status: Current status of the task
        owner: User who owns this task
        assignee: Assigned user (or None)
        notes: Additional notes about the task
        priority_order_index: Index for sorting by priority
        estimated_hours: Estimated hours required
        time_spent: Hours spent on this task so far
        progress_percentage: Percentage complete
        completion_status: String representation of completion state
        assigned_to: Specific person assigned (None means auto-assigned)
        linked_issues: Linked issue IDs
        custom_fields: Dictionary of custom attributes
    """
    
    # Core Identity
    _id: str = field(default_factory=lambda: f"task_{hash(deepcopy(__dict__))}_{int(datetime.now().timestamp())}")
    
    # Metadata Fields
    title: str = "Untitled Task"
    description: str = "No description available."
    content: str = ""
    due_date: Optional[date] = None
    deadline: datetime | None = None
    priority: PriorityLevel = PriorityLevel.MEDIUM
    tags: List[Tag] = field(default_factory=list)
    subtasks: List['Task'] = field(default_factory=list)
    parent_id: Optional[str] = None
    user_ids: set = field(default_factory=set)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = None
    is_deleted: bool = False
    source_file: Optional[str] = None
    source_line: int = 0
    status: Status = Status.DRAFT
    owner: Optional[str] = None
    assignee: Optional[str] = None
    notes: str = ""
    priority_order_index: int = 1
    estimated_hours: float = 24.0
    time_spent: float = 0.0
    progress_percentage: float = 0.0
    completed_by_user_id: Optional[str] = None
    assignment_date: Optional[datetime] = None
    linked_issues: list = field(default_factory=list)  # Issue ID references
    custom_fields: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        if not self._id:
            raise ValueError("Task must have a valid id")
        
        # Validate date fields
        if self.due_date and isinstance(self.due_date, date):
            try:
                self.deadline = self.deadline or self.due_date.replace(hour=0, minute=0, second=0, microsecond=0)
            except Exception as e:
                print(f"Warning: Failed to parse due_date {self.due_date}: {e}")
                self.deadline = None
        elif not (self.deadline and isinstance(self.deadline, datetime)):
            raise ValueError("deadline must be a datetime object or default to due_date")
        
        # Ensure consistent ordering for sorting
        self.priority_order_index = self.priority.value.lower()
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Task':
        """Create Task instance from dictionary."""
        task = cls(
            title=data.get('title', ''),
            description=data.get('description', '') or '',
            content=data.get('content', ''),
            due_date=data.get('due_date'),
            deadline=data.get('deadline') if 'deadline' in data else None,
            priority=PriorityLevel(data.get('priority', 'medium').lower()),
            tags=[Tag.from_string(t.strip()) if t.strip() else Tag(name='', color='#FF0000') 
                  for t in data.get('tags', [])],
            subtasks=[Task.from_dict(subtask) for subtask in data.get('subtasks', [])],
            parent_id=data.get('parent_id'),
            user_ids=set(data.get('user_ids', [])),
            created_at=datetime.now(),
            updated_at=datetime.now(),
            deleted_at=None,
            is_deleted=False,
            source_file=data.get('sourceFile'),
            source_line=data.get('sourceLine'),
            status=Status.DRAFT,
            owner=data.get('owner') if 'owner' in data else None,
            assignee=data.get('assignee'),
            notes=data.get('notes', ''),
            estimated_hours=float(data.get('estimatedHours', 24.0)),
            time_spent=float(data.get('timeSpent', 0.0)),
            progress_percentage=float(data.get('progressPercentage', 0.0)),
            completed_by_user_id=data.get('completedByUser'),
            assignment_date=datetime.now() if data.get('assignmentDate') else None,
            linked_issues=data.get('linkedIssues', []),
            custom_fields={k: v for k, v in data.items() if k != '_id'}  # Remove internal fields
        )
        return task
    
    def __repr__(self):
        return f"Task(id='{self._id}', title='{self.title}')"
    
    def copy(self) -> 'Task':
        """Create a deep copy of this task."""
        new_task =