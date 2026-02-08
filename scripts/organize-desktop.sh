#!/usr/bin/env bash

set -euo pipefail

DESKTOP_DIR="${HOME}/Desktop"

if [ ! -d "${DESKTOP_DIR}" ]; then
  echo "Desktop directory not found at ${DESKTOP_DIR}" >&2
  exit 1
fi

get_target_folder() {
  local ext="$1"

  case "${ext}" in
    jpg|jpeg|png|gif|webp|bmp|tif|tiff|heic|svg|avif)
      echo "Images"
      ;;
    pdf|doc|docx|txt|rtf|odt|pages|xls|xlsx|csv|ppt|pptx|key|md)
      echo "Documents"
      ;;
    mp4|mov|mkv|avi|webm|m4v)
      echo "Videos"
      ;;
    mp3|wav|aac|flac|m4a|ogg)
      echo "Audio"
      ;;
    zip|rar|7z|tar|gz|bz2|xz|tgz)
      echo "Archives"
      ;;
    js|ts|jsx|tsx|py|java|c|cpp|cc|cxx|h|hpp|cs|go|rs|rb|php|swift|kt|sh|zsh|html|css|json|yaml|yml|toml|xml|sql)
      echo "Code"
      ;;
    app|dmg|pkg)
      echo "Apps"
      ;;
    *)
      echo "Other"
      ;;
  esac
}

total_seen=0
moved=0
skipped_conflicts=0

shopt -s nullglob
for file_path in "${DESKTOP_DIR}"/*; do
  if [ ! -f "${file_path}" ]; then
    continue
  fi

  file_name="$(basename "${file_path}")"
  total_seen=$((total_seen + 1))

  extension=""
  if [[ "${file_name}" == *.* ]]; then
    extension="${file_name##*.}"
    extension="$(printf "%s" "${extension}" | tr '[:upper:]' '[:lower:]')"
  fi

  folder_name="$(get_target_folder "${extension}")"
  destination_dir="${DESKTOP_DIR}/${folder_name}"
  destination_path="${destination_dir}/${file_name}"

  mkdir -p "${destination_dir}"

  if [ -e "${destination_path}" ]; then
    skipped_conflicts=$((skipped_conflicts + 1))
    continue
  fi

  mv "${file_path}" "${destination_path}"
  moved=$((moved + 1))
done

echo "SUMMARY_MOVED=${moved}"
echo "SUMMARY_SKIPPED_CONFLICTS=${skipped_conflicts}"
echo "SUMMARY_TOTAL_SEEN=${total_seen}"
