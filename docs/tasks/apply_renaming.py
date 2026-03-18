import os
import re
import sys

# Define logical root for tasks
tasks_dir = r"c:\Work\Tallent\Cubica\docs\tasks"
project_root = r"c:\Work\Tallent\Cubica"

subdirs = ["content-packs", "epics", "features", "milestones"]

# Regex: Type-Year-Number-Name.ext
pattern = re.compile(r"^([A-Z]+)-(\d{2})-(\d+)-(.*)(\.[a-z]+)$")

tasks = []

def scan_files():
    for subdir in subdirs:
        path = os.path.join(tasks_dir, subdir)
        if not os.path.exists(path):
            continue
        for filename in os.listdir(path):
            filepath = os.path.join(path, filename)
            if not os.path.isfile(filepath):
                continue
            
            match = pattern.match(filename)
            if match:
                type_ = match.group(1)
                year = match.group(2)
                num = match.group(3)
                name_part = match.group(4)
                extension = match.group(5)
                
                tasks.append({
                    "filename": filename,
                    "filepath": filepath,
                    "subdir": subdir,
                    "type": type_,
                    "year": year,
                    "num": num,
                    "name_part": name_part,
                    "ext": extension,
                    "old_id": f"{type_}-{year}-{num}"
                })

scan_files()
# Sort: Year 25 first
tasks.sort(key=lambda x: (x['year'], x['num'], x['type']))

used_numbers = {} # type -> set(int)
id_map = {} # old_id -> new_id
file_map = {} # old_filename -> new_filename

# Logic strictly matching the generation script
all_original_nums = {}
for task in tasks:
    t = task['type']
    if t not in all_original_nums:
        all_original_nums[t] = set()
    all_original_nums[t].add(int(task['num']))

for task in tasks:
    t_type = task['type']
    if t_type not in used_numbers:
        used_numbers[t_type] = set()

    original_num_int = int(task['num'])
    
    if task['year'] == '25':
        used_numbers[t_type].add(original_num_int)
        new_id_str = f"{t_type}_{task['num']}"
        id_map[task['old_id']] = new_id_str
        
        # Calculate new filename
        # Replace IDs in name part if any?
        # Note: referencing OTHER ids in valid name parts is rare in filenames, but we should be consistent.
        # But wait, we can't reliably replace IDs in name parts UNTIL we know all ID mappings.
        # But we iterate linearly.
        # Actually, simpler: Filename generation happens AFTER all IDs are mapped? 
        # Yes, we should calculate IDs first, then filenames.
        
        task['new_num'] = task['num']
        
    else:
        # Year 26 (or other)
        # Check collision with Year 25
        is_collision = False
        for other in tasks:
            if other['year'] == '25' and other['type'] == t_type and int(other['num']) == original_num_int:
                is_collision = True
                break
        
        target_num = original_num_int
        if is_collision or (target_num in used_numbers[t_type]):
             # Find new
             candidate = target_num
             while True:
                candidate += 1
                if (candidate not in all_original_nums[t_type]) and (candidate not in used_numbers[t_type]):
                    break
             target_num = candidate
        
        used_numbers[t_type].add(target_num)
        new_num_str = f"{target_num:05d}"
        
        new_id_str = f"{t_type}_{new_num_str}"
        id_map[task['old_id']] = new_id_str
        task['new_num'] = new_num_str

# Now calculate new filenames (Requires full id_map for references inside filenames)
for task in tasks:
    name_current = task['name_part']
    
    # Replace any embedded IDs in the filename first (e.g. F-..-(E_0010).md)
    def replace_id_in_str(match):
        full_id = match.group(0)
        return id_map.get(full_id, full_id)
        
    name_updated_refs = re.sub(r"[A-Z]+-\d{2}-\d+", replace_id_in_str, name_current)
    name_final = name_updated_refs.replace('-', '_') # Replace dashes
    
    new_filename = f"{task['type']}_{task['new_num']}_{name_final}{task['ext']}"
    file_map[task['filename']] = new_filename
    task['new_filename'] = new_filename
    task['new_filepath'] = os.path.join(tasks_dir, task['subdir'], new_filename)

# EXECUTION START

print("Renaming files on disk...")
renamed_count = 0
for task in tasks:
    if task['filepath'] != task['new_filepath']:
        try:
            os.rename(task['filepath'], task['new_filepath'])
            renamed_count += 1
        except OSError as e:
            print(f"Error renaming {task['filepath']} to {task['new_filepath']}: {e}")

print(f"Renamed {renamed_count} files.")

print("Updating references in project files...")

# Prepare replacement list
# Order: Filenames first (longest to shortest for stability), then IDs (longest to shortest)
# Actually, filenames are usually unique enough.
# Filenames: "F-25-0010-foo.md" -> "F_00010_foo.md"
# IDs: "F-25-0010" -> "F_00010"

replacements = []
for old_f, new_f in file_map.items():
    replacements.append((old_f, new_f))
for old_id, new_id in id_map.items():
    replacements.append((old_id, new_id))

# Sort by length of key descending
replacements.sort(key=lambda x: len(x[0]), reverse=True)

# Walk project
files_scanned = 0
files_modified = 0

ignore_dirs = {'.git', 'node_modules', '.agent', 'dist', 'build', '.gemini', 'tmp'}
binary_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.exe', '.dll'}

for root, dirs, files in os.walk(project_root):
    # Filter dirs
    dirs[:] = [d for d in dirs if d not in ignore_dirs]
    
    for filename in files:
        # Check extension
        _, ext = os.path.splitext(filename)
        if ext.lower() in binary_extensions:
            continue
            
        filepath = os.path.join(root, filename)
        files_scanned += 1
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            
            new_content = content
            changed = False
            
            for old_s, new_s in replacements:
                if old_s in new_content:
                    new_content = new_content.replace(old_s, new_s)
                    changed = True
            
            if changed:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                files_modified += 1
                
        except UnicodeDecodeError:
            # Skip binary/encoding issues
            pass
        except Exception as e:
            print(f"Error processing {filepath}: {e}")

print(f"Scanned {files_scanned} files.")
print(f"Modified {files_modified} files.")
