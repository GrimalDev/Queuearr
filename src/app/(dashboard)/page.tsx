import { SearchBar } from '@/components/features/search-bar';
import { SearchResults } from '@/components/features/search-results';

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold mb-2">Search Media</h1>
          <p className="text-muted-foreground">
            Find movies and series to add to your library
          </p>
        </div>
        <SearchBar />
      </div>
      <SearchResults />
    </div>
  );
}
