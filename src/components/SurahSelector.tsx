import { useEffect, useState } from 'react';
import { fetchSurahList, type SurahInfo } from '@/lib/quranApi';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SurahSelectorProps {
  selectedSurah: number;
  onSelect: (surahNumber: number) => void;
  disabled?: boolean;
}

export function SurahSelector({ selectedSurah, onSelect, disabled }: SurahSelectorProps) {
  const [surahs, setSurahs] = useState<SurahInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSurahList()
      .then(setSurahs)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <Select
      value={String(selectedSurah)}
      onValueChange={(val) => onSelect(Number(val))}
      disabled={disabled || loading}
    >
      <SelectTrigger className="w-[320px] border-border bg-card text-foreground">
        <SelectValue placeholder={loading ? 'Loading surahs...' : 'Select a Surah'} />
      </SelectTrigger>
      <SelectContent className="max-h-[400px] bg-card border-border z-50">
        {surahs.map((surah) => (
          <SelectItem
            key={surah.number}
            value={String(surah.number)}
            className="text-foreground"
          >
            <span className="font-quran text-gold mr-2">{surah.number}.</span>{' '}
            <span className="font-quran">{surah.name}</span>{' '}
            <span className="text-muted-foreground text-sm">— {surah.englishName}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
