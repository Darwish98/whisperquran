import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export function useUserProgress() {
  const { user } = useAuth();

  const saveProgress = useCallback(async (
    surahNumber: number,
    lastWordIndex: number,
    totalWords: number,
    correctWords: number,
    completed: boolean
  ) => {
    if (!user) return;
    
    await supabase.from('user_progress').upsert({
      user_id: user.id,
      surah_number: surahNumber,
      last_word_index: lastWordIndex,
      total_words: totalWords,
      correct_words: correctWords,
      completed,
    }, { onConflict: 'user_id,surah_number' });
  }, [user]);

  const loadProgress = useCallback(async (surahNumber: number) => {
    if (!user) return null;
    
    const { data } = await supabase
      .from('user_progress')
      .select('*')
      .eq('user_id', user.id)
      .eq('surah_number', surahNumber)
      .maybeSingle();
    
    return data;
  }, [user]);

  const saveRecitationHistory = useCallback(async (
    surahNumber: number,
    durationSeconds: number,
    wordsAttempted: number,
    wordsCorrect: number
  ) => {
    if (!user) return;
    
    await supabase.from('recitation_history').insert({
      user_id: user.id,
      surah_number: surahNumber,
      duration_seconds: durationSeconds,
      words_attempted: wordsAttempted,
      words_correct: wordsCorrect,
      accuracy: wordsAttempted > 0 ? wordsCorrect / wordsAttempted : 0,
    });
  }, [user]);

  return { saveProgress, loadProgress, saveRecitationHistory };
}
