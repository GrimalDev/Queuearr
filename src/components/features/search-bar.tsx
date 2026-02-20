'use client';

import { useState, useEffect } from 'react';
import { Search, X, Film, Tv, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSearch } from '@/hooks/use-media';
import { cn } from '@/lib/utils';

export function SearchBar() {
  const { searchQuery, isSearching, searchType, setSearchType, search, clearSearch } = useSearch();
  const [inputValue, setInputValue] = useState(searchQuery);

  useEffect(() => {
    if (searchType === 'all') {
      setSearchType('movies');
    }
  }, [searchType, setSearchType]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    search(value);
  };

  const handleClear = () => {
    setInputValue('');
    clearSearch();
  };

  return (
    <div className="w-full space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder={`Search for ${searchType === 'movies' ? 'movies' : 'series'}...`}
          value={inputValue}
          onChange={handleInputChange}
          className="pl-10 pr-10 h-10 sm:h-12 text-base sm:text-lg"
        />
        {isSearching && (
          <Loader2 className="absolute right-10 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {inputValue && !isSearching && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 p-0"
            onClick={handleClear}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          variant={searchType === 'movies' ? 'default' : 'outline'}
          className={cn('flex-1 gap-2', searchType === 'movies' && 'bg-primary')}
          onClick={() => setSearchType('movies')}
        >
          <Film className="h-4 w-4" />
          Movies
        </Button>
        <Button
          variant={searchType === 'series' ? 'default' : 'outline'}
          className={cn('flex-1 gap-2', searchType === 'series' && 'bg-primary')}
          onClick={() => setSearchType('series')}
        >
          <Tv className="h-4 w-4" />
          Series
        </Button>
      </div>
    </div>
  );
}
